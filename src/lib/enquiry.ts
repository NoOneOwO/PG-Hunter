/**
 * PG Hunter — the enquiry form's contract, shared by the browser, the API and
 * the tests.
 *
 * Dependency-free on purpose (no D1, no Cloudflare bindings) so `npm test` can
 * exercise the real validation rules under plain Node. The server re-runs all
 * of this on every submission; the form's checks are a courtesy, not the gate.
 */

/* ------------------------------------------------------------------ */
/* Enumerations                                                        */
/* ------------------------------------------------------------------ */

export const ENQUIRY_BUDGETS = ['under-10', '10-15', '15-20', '20-plus', 'custom'] as const;
export type EnquiryBudget = (typeof ENQUIRY_BUDGETS)[number];

export const ENQUIRY_ROOM_TYPES = ['single', 'double', 'triple', 'any'] as const;
export type EnquiryRoomType = (typeof ENQUIRY_ROOM_TYPES)[number];

export const MESSAGE_MAX_LENGTH = 500;
export const NAME_MAX_LENGTH = 80;
export const COLLEGE_MAX_LENGTH = 100;
/** Same student + same PG inside this window is treated as a duplicate. */
export const DUPLICATE_WINDOW_MINUTES = 60;

export const WHATSAPP_INTRO =
  "Hi, I found your PG on PG Hunter and have submitted an enquiry. I'd like to know more about availability.";

/* ------------------------------------------------------------------ */
/* Phone handling                                                      */
/* ------------------------------------------------------------------ */

/**
 * Normalise an Indian mobile number to `91XXXXXXXXXX` (no plus).
 *
 * Accepts spaces, dashes, parentheses and an optional +91/0 prefix. Returns
 * null when the result is not a plausible 10-digit Indian mobile, so a
 * mistyped number never becomes the number an owner dials.
 */
export const normalizePhone = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  digits = digits.replace(/^0+/, '');
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `91${digits}`;
};

/** Display form for a normalised number: +91 98765 43210. */
export const formatEnquiryPhone = (normalized: string): string =>
  normalized.length === 12 ? `+${normalized.slice(0, 2)} ${normalized.slice(2, 7)} ${normalized.slice(7)}` : `+${normalized}`;

export interface EnquiryContact {
  /** E.164 without the plus, e.g. 919876543210. */
  phone: string;
  display: string;
  /** WhatsApp click-to-chat URL; opens the chat, never sends on its own. */
  whatsappUrl: string;
}

/** Official click-to-chat URL, or null when the number is unusable. */
export const buildContact = (ownerPhone: string | null): EnquiryContact | null => {
  const normalized = normalizePhone(ownerPhone);
  if (!normalized) return null;
  return {
    phone: normalized,
    display: formatEnquiryPhone(normalized),
    whatsappUrl: `https://wa.me/${normalized}?text=${encodeURIComponent(WHATSAPP_INTRO)}`,
  };
};

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface EnquiryInput {
  propertyId: string;
  name: string;
  college: string | null;
  phone: string | null;
  budget: string;
  moveInMonth: string | null;
  roomType: EnquiryRoomType;
  message: string | null;
  consent: boolean;
}

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Validate one enquiry payload. Returns the cleaned value or the single
 * message to show the student — never both, never a raw database error.
 */
export const parseEnquiry = (
  body: Record<string, unknown> | null
): { ok: true; value: EnquiryInput } | { ok: false; error: string } => {
  if (!body) return { ok: false, error: 'Could not read the form. Please try again.' };

  const propertyId = asString(body.propertyId);
  if (!propertyId) return { ok: false, error: 'This enquiry is missing its PG. Reload the page and try again.' };

  const name = asString(body.name);
  if (name.length < 2) return { ok: false, error: 'Please enter your full name.' };
  if (name.length > NAME_MAX_LENGTH) return { ok: false, error: `Name must be under ${NAME_MAX_LENGTH} characters.` };

  const college = asString(body.college) || null;
  if (college && college.length > COLLEGE_MAX_LENGTH) {
    return { ok: false, error: `College name must be under ${COLLEGE_MAX_LENGTH} characters.` };
  }

  const rawPhone = asString(body.phone);
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) {
    return { ok: false, error: 'Enter a valid 10-digit mobile number, or leave it empty.' };
  }

  const budget = asString(body.budget);
  if (!(ENQUIRY_BUDGETS as readonly string[]).includes(budget)) {
    return { ok: false, error: 'Please choose your monthly budget.' };
  }
  let budgetValue: string = budget;
  if (budget === 'custom') {
    const custom = Number(body.customBudget);
    if (!Number.isFinite(custom) || custom < 1000 || custom > 500000) {
      return { ok: false, error: 'Enter a custom budget between ₹1,000 and ₹5,00,000.' };
    }
    budgetValue = `custom:${Math.round(custom)}`;
  }

  const moveInMonth = asString(body.moveInMonth) || null;
  if (moveInMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(moveInMonth)) {
    return { ok: false, error: 'Pick the month you plan to move in.' };
  }

  const roomType = asString(body.roomType) || 'any';
  if (!(ENQUIRY_ROOM_TYPES as readonly string[]).includes(roomType)) {
    return { ok: false, error: 'Choose a room type.' };
  }

  const message = asString(body.message) || null;
  if (message && message.length > MESSAGE_MAX_LENGTH) {
    return { ok: false, error: `Keep your message under ${MESSAGE_MAX_LENGTH} characters.` };
  }

  // Consent only means something when a number is actually being shared.
  const consent = phone ? body.consent === true : false;

  return {
    ok: true,
    value: {
      propertyId,
      name,
      college,
      phone,
      budget: budgetValue,
      moveInMonth,
      roomType: roomType as EnquiryRoomType,
      message,
      consent,
    },
  };
};
