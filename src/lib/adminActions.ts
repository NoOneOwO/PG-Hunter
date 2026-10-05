/**
 * PG Hunter — admin moderation actions.
 *
 * The admin pages are server-rendered .astro with small client scripts, so the
 * moderation UI is a shared vanilla dialog rather than a React island: one
 * modal, built lazily, driven by a declarative field list. Every action goes
 * through the real API (`/api/admin/*`), which owns the rules — approving a
 * listing never grants verification, and revoking one requires a reason.
 *
 *   import { openAdminDialog, sendAdmin, listingModeration } from '@/lib/adminActions';
 *   listingModeration({ id, name }).approve();
 */

import { animate } from 'motion';
import { toast } from '@/lib/toast';

export interface DialogField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  value?: string;
  rows?: number;
}

export interface AdminDialogConfig {
  title: string;
  description?: string;
  submitLabel?: string;
  tone?: 'primary' | 'danger';
  fields?: DialogField[];
  confirmOnly?: string;
  onSubmit: (values: Record<string, string>) => Promise<{ error?: string }>;
}

/* ------------------------------------------------------------- modal ---- */

let modalHost: HTMLElement | null = null;

const buildHost = (): HTMLElement => {
  if (modalHost) return modalHost;

  const host = document.createElement('div');
  host.id = 'admin-action-dialog';
  host.className = 'fixed inset-0 z-[70] hidden items-center justify-center bg-slate-900/60 p-4';
  host.innerHTML = `
    <div role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title"
      class="w-full max-w-lg border border-slate-200 bg-white p-6 shadow-popover">
      <h2 id="admin-dialog-title" class="text-lg font-extrabold tracking-tight text-slate-900"></h2>
      <p id="admin-dialog-desc" class="mt-1 text-sm text-slate-500"></p>
      <form id="admin-dialog-form" class="mt-4 flex flex-col gap-4"></form>
      <p id="admin-dialog-error" class="mt-3 hidden border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700" role="alert"></p>
    </div>
  `;
  document.body.appendChild(host);
  modalHost = host;
  return host;
};

const closeDialog = (): void => {
  if (!modalHost) return;
  const panel = modalHost.firstElementChild as HTMLElement | null;
  const finish = () => {
    modalHost!.classList.add('hidden');
    modalHost!.classList.remove('flex');
  };
  if (panel) void animate(panel, { opacity: 0, transform: 'scale(0.97)' }, { duration: 0.12 }).finished.then(finish);
  else finish();
};

const field = (config: DialogField): HTMLElement => {
  const wrap = document.createElement('label');
  wrap.className = 'flex flex-col gap-1.5';

  const label = document.createElement('span');
  label.className = 'text-sm font-semibold text-slate-800';
  label.textContent = config.label + (config.required ? '' : ' (optional)');
  wrap.appendChild(label);

  const shared =
    'w-full border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-400';

  if (config.type === 'select') {
    const select = document.createElement('select');
    select.name = config.name;
    select.className = shared;
    if (config.required) select.required = true;
    for (const option of config.options ?? []) {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      if (option.value === config.value) el.selected = true;
      select.appendChild(el);
    }
    wrap.appendChild(select);
  } else if (config.type === 'textarea') {
    const area = document.createElement('textarea');
    area.name = config.name;
    area.className = `${shared} resize-none`;
    area.rows = config.rows ?? 4;
    if (config.placeholder) area.placeholder = config.placeholder;
    if (config.required) area.required = true;
    // Free text that ends up in an audit row: keep it inside the server caps.
    area.maxLength = 2000;
    wrap.appendChild(area);
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    input.name = config.name;
    input.className = shared;
    if (config.placeholder) input.placeholder = config.placeholder;
    if (config.value) input.value = config.value;
    if (config.required) input.required = true;
    wrap.appendChild(input);
  }

  if (config.hint) {
    const hint = document.createElement('span');
    hint.className = 'text-xs text-slate-500';
    hint.textContent = config.hint;
    wrap.appendChild(hint);
  }
  return wrap;
};

/** Open the shared admin dialog. Returns once it has been shown. */
export const openAdminDialog = (config: AdminDialogConfig): void => {
  const host = buildHost();
  const panel = host.firstElementChild as HTMLElement;
  const title = host.querySelector('#admin-dialog-title') as HTMLElement;
  const desc = host.querySelector('#admin-dialog-desc') as HTMLElement;
  const form = host.querySelector('#admin-dialog-form') as HTMLFormElement;
  const errorEl = host.querySelector('#admin-dialog-error') as HTMLElement;

  title.textContent = config.title;
  if (config.description) {
    desc.textContent = config.description;
    desc.classList.remove('hidden');
  } else {
    desc.textContent = '';
    desc.classList.add('hidden');
  }
  errorEl.classList.add('hidden');
  errorEl.textContent = '';

  form.replaceChildren();
  for (const item of config.fields ?? []) form.appendChild(field(item));
  if (config.confirmOnly) {
    const note = document.createElement('p');
    note.className = 'text-sm text-slate-600';
    note.textContent = config.confirmOnly;
    form.appendChild(note);
  }

  const actions = document.createElement('div');
  actions.className = 'mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-secondary px-5';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeDialog);
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = config.tone === 'danger' ? 'btn-danger px-5' : 'btn-primary px-5';
  submit.textContent = config.submitLabel ?? 'Confirm';
  actions.append(cancel, submit);
  form.appendChild(actions);

  form.onsubmit = async (event) => {
    event.preventDefault();
    const values: Record<string, string> = {};
    for (const [key, value] of new FormData(form).entries()) values[key] = String(value);

    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = 'Working…';
    const result = await config.onSubmit(values);
    submit.disabled = false;
    submit.textContent = original;

    if (result.error) {
      errorEl.textContent = result.error;
      errorEl.classList.remove('hidden');
      return;
    }
    closeDialog();
  };

  host.classList.remove('hidden');
  host.classList.add('flex');
  void animate(panel, { opacity: [0, 1], transform: ['scale(0.97)', 'scale(1)'] }, { duration: 0.16 });
  const firstField = form.querySelector<HTMLElement>('input, textarea, select');
  firstField?.focus();
};

hostListener();
function hostListener(): void {
  document.addEventListener('click', (event) => {
    if (event.target === modalHost) closeDialog();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDialog();
  });
}

/* --------------------------------------------------------------- api ---- */

export interface AdminResult {
  error?: string;
}

/** Send an admin mutation and surface the server's error verbatim. */
export const sendAdmin = async (
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<AdminResult> => {
  try {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return {};
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { error: data.error ?? `Request failed (${res.status}).` };
  } catch {
    return { error: 'Network error — check your connection and try again.' };
  }
};

/* --------------------------------------------------- listing actions ---- */

export interface ListingModeration {
  approve: () => void;
  reject: () => void;
  markPending: () => void;
  grantVerification: () => void;
  revokeVerification: () => void;
}

/**
 * Moderation verbs for one listing.
 *
 * `after` runs on success (the admin pages refresh the row in place); each
 * dialog mirrors exactly what the API requires — rejection needs a reason,
 * verification needs a method and evidence, revocation needs a reason.
 */
export const listingModeration = (input: {
  id: string;
  name: string;
  after?: () => void;
}): ListingModeration => {
  const done = (message: string, description?: string) => {
    toast.success(message, description);
    input.after?.();
  };

  const path = `/api/admin/listings/${encodeURIComponent(input.id)}`;

  return {
    approve: () =>
      openAdminDialog({
        title: `Approve “${input.name}”?`,
        description: 'Approving publishes the listing and opens its plan window.',
        submitLabel: 'Approve listing',
        fields: [
          {
            name: 'plan',
            label: 'Publication window',
            type: 'select',
            value: 'verified',
            options: [
              { value: 'verified', label: 'Verified plan — 365 days' },
              { value: 'basic', label: 'Basic plan — 15 days' },
            ],
            hint: 'An expired listing is hidden from the public site, never deleted.',
          },
        ],
        onSubmit: async (values) => {
          const result = await sendAdmin('PUT', path, {
            status: 'active',
            plan: values.plan === 'basic' ? 'basic' : 'verified',
          });
          if (!result.error) done('Listing approved', `${input.name} is live on the public site.`);
          return result;
        },
      }),

    reject: () =>
      openAdminDialog({
        title: `Reject “${input.name}”?`,
        description: 'The owner sees this reason on their listing, so make it actionable.',
        submitLabel: 'Reject listing',
        tone: 'danger',
        fields: [
          {
            name: 'rejectionReason',
            label: 'Reason',
            type: 'textarea',
            required: true,
            rows: 3,
            placeholder: 'e.g. Rent is missing for two room types, and the address does not match the photos.',
          },
        ],
        onSubmit: async (values) => {
          const result = await sendAdmin('PUT', path, {
            status: 'rejected',
            rejectionReason: values.rejectionReason,
          });
          if (!result.error) done('Listing rejected', 'The owner can fix it and resubmit.');
          return result;
        },
      }),

    markPending: () =>
      openAdminDialog({
        title: `Return “${input.name}” to review?`,
        description: 'The listing leaves the public site until it is approved again.',
        submitLabel: 'Move to pending',
        onSubmit: async () => {
          const result = await sendAdmin('PUT', path, { status: 'pending' });
          if (!result.error) done('Moved back to pending');
          return result;
        },
      }),

    grantVerification: () =>
      openAdminDialog({
        title: `Grant verification to “${input.name}”`,
        description:
          'Publishing is not verifying. This records who verified, how, on what evidence, and until when.',
        submitLabel: 'Grant badge',
        fields: [
          {
            name: 'tier',
            label: 'Badge',
            type: 'select',
            value: 'pg_hunter_verified',
            options: [
              { value: 'pg_hunter_verified', label: 'PG Hunter Verified' },
              { value: 'rishabh_irl_verified', label: 'Rishabh IRL Verified' },
            ],
          },
          {
            name: 'method',
            label: 'Method',
            type: 'select',
            value: 'document_review',
            options: [
              { value: 'document_review', label: 'Document review' },
              { value: 'video_review', label: 'Video review' },
              { value: 'physical_visit', label: 'Physical visit' },
            ],
          },
          {
            name: 'evidence',
            label: 'Evidence',
            type: 'textarea',
            required: true,
            rows: 3,
            placeholder: 'e.g. Visited 12 Oct, met the manager, saw the lease (ref 4471) and both floors.',
            hint: 'Required — a bare approval click is not a verification.',
          },
          { name: 'note', label: 'Internal note', type: 'text', placeholder: 'Optional context for the ledger' },
        ],
        onSubmit: async (values) => {
          const result = await sendAdmin('PUT', path, {
            action: 'grant',
            tier: values.tier,
            method: values.method,
            evidence: values.evidence,
            note: values.note || undefined,
          });
          if (!result.error) done('Verification granted', 'Recorded on the verification ledger.');
          return result;
        },
      }),

    revokeVerification: () =>
      openAdminDialog({
        title: `Revoke verification for “${input.name}”`,
        description: 'The ledger keeps the history; the listing returns to review.',
        submitLabel: 'Revoke badge',
        tone: 'danger',
        fields: [
          {
            name: 'reason',
            label: 'Why is the badge being withdrawn?',
            type: 'textarea',
            required: true,
            rows: 3,
            placeholder: 'e.g. Owner changed the property to a different building in November.',
          },
        ],
        onSubmit: async (values) => {
          const result = await sendAdmin('PUT', path, {
            action: 'revoke',
            reason: values.reason,
          });
          if (!result.error) done('Verification revoked', 'The reason is on the ledger.');
          return result;
        },
      }),
  };
};

/** Wire every `[data-mod]` button inside `root` to its listing action. */
export const bindListingModeration = (root: ParentNode = document): void => {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('[data-mod][data-listing-id]'));
  for (const button of buttons) {
    if (button.dataset.modBound) continue;
    button.dataset.modBound = '1';

    const id = button.dataset.listingId ?? '';
    const name = button.dataset.listingName ?? 'this listing';
    const action = button.dataset.mod ?? '';
    if (!id) continue;

    const after = () => window.location.reload();
    const verbs = listingModeration({ id, name, after });

    button.addEventListener('click', () => {
      if (action === 'approve') verbs.approve();
      else if (action === 'reject') verbs.reject();
      else if (action === 'pending') verbs.markPending();
      else if (action === 'grant') verbs.grantVerification();
      else if (action === 'revoke') verbs.revokeVerification();
    });
  }
};
