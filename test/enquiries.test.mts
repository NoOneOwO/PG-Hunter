/**
 * PG Hunter — enquiry validation and contact-link rules.
 *
 * These lock in the behaviour the API relies on: a phone number only ever
 * becomes a dialable value after normalisation, the form's closed enums cannot
 * be bypassed by a hand-crafted request, message length is capped, and consent
 * is only meaningful when a number is actually being shared.
 *
 * The module under test is dependency-free, so this runs under plain Node with
 * no D1 binding and no Astro runtime. Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ENQUIRY_BUDGETS,
  MESSAGE_MAX_LENGTH,
  WHATSAPP_INTRO,
  buildContact,
  formatEnquiryPhone,
  normalizePhone,
  parseEnquiry,
} from '../src/lib/enquiry.ts';

const valid = {
  propertyId: '8b0e0a4c-1111-4222-8333-444455556666',
  name: 'Riya Sharma',
  college: 'Delhi Technological University',
  phone: '9876543210',
  budget: '10-15',
  moveInMonth: '2026-08',
  roomType: 'double',
  message: 'Looking for a single room near the metro.',
  consent: true,
};

test('normalizePhone accepts the shapes students actually type', () => {
  assert.equal(normalizePhone('9876543210'), '919876543210');
  assert.equal(normalizePhone('+91 98765 43210'), '919876543210');
  assert.equal(normalizePhone('919876543210'), '919876543210');
  assert.equal(normalizePhone('098765 43210'), '919876543210');
  assert.equal(normalizePhone('(98765) 43210'), '919876543210');
});

test('normalizePhone rejects numbers that cannot be dialled', () => {
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('5876543210'), null, 'Indian mobiles start 6-9');
  assert.equal(normalizePhone('not a number'), null);
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone(9876543210 as unknown), null, 'non-strings are refused');
});

test('formatEnquiryPhone is the display form for the normalised value', () => {
  assert.equal(formatEnquiryPhone('919876543210'), '+91 98765 43210');
});

test('buildContact only produces links from a valid owner number', () => {
  assert.equal(buildContact(null), null);
  assert.equal(buildContact('12345'), null);

  const contact = buildContact('+91 98765 43210');
  assert.ok(contact);
  assert.equal(contact.phone, '919876543210');
  assert.equal(contact.display, '+91 98765 43210');
  assert.ok(contact.whatsappUrl.startsWith('https://wa.me/919876543210?text='));
  // The message is prefilled for the student to review — never sent by us.
  assert.ok(contact.whatsappUrl.includes(encodeURIComponent(WHATSAPP_INTRO)));
});

test('parseEnquiry accepts a complete payload and cleans it', () => {
  const parsed = parseEnquiry({ ...valid, phone: '+91 98765 43210' });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.name, 'Riya Sharma');
  assert.equal(parsed.value.phone, '919876543210');
  assert.equal(parsed.value.college, 'Delhi Technological University');
  assert.equal(parsed.value.roomType, 'double');
  assert.equal(parsed.value.consent, true);
  assert.equal(parsed.value.moveInMonth, '2026-08');
});

test('parseEnquiry defaults an omitted room type to "any"', () => {
  const parsed = parseEnquiry({ ...valid, roomType: undefined });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.roomType, 'any');
});

test('parseEnquiry rejects missing or nonsense fields', () => {
  const cases: Record<string, unknown>[] = [
    { ...valid, propertyId: '' },
    { ...valid, name: 'R' },
    { ...valid, phone: '12' },
    { ...valid, budget: 'lots' },
    { ...valid, budget: undefined },
    { ...valid, roomType: 'penthouse' },
    { ...valid, moveInMonth: '2026-13' },
    { ...valid, message: 'x'.repeat(MESSAGE_MAX_LENGTH + 1) },
    { ...valid, college: 'x'.repeat(101) },
  ];

  for (const payload of cases) {
    const parsed = parseEnquiry(payload);
    assert.equal(parsed.ok, false, `should reject ${JSON.stringify(payload).slice(0, 90)}`);
    if (!parsed.ok) assert.ok(parsed.error.length > 0);
  }

  assert.equal(parseEnquiry(null).ok, false);
});

test('parseEnquiry enforces the custom budget range and stores the amount', () => {
  assert.equal(parseEnquiry({ ...valid, budget: 'custom', customBudget: 500 }).ok, false);
  assert.equal(parseEnquiry({ ...valid, budget: 'custom', customBudget: 'abc' }).ok, false);
  assert.equal(parseEnquiry({ ...valid, budget: 'custom', customBudget: 900000 }).ok, false);

  const parsed = parseEnquiry({ ...valid, budget: 'custom', customBudget: 12500 });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.budget, 'custom:12500');
});

test('consent is only recorded when a number is actually shared', () => {
  const withoutPhone = parseEnquiry({ ...valid, phone: '', consent: true });
  assert.equal(withoutPhone.ok, true);
  if (withoutPhone.ok) {
    assert.equal(withoutPhone.value.phone, null);
    assert.equal(withoutPhone.value.consent, false, 'nothing is shared, so there is nothing to consent to');
  }

  const unticked = parseEnquiry({ ...valid, consent: false });
  assert.equal(unticked.ok, true);
  if (unticked.ok) {
    assert.equal(unticked.value.phone, '919876543210', 'the number can still be saved to the account');
    assert.equal(unticked.value.consent, false, 'but it must not be shared with the owner');
  }
});

test('the budget vocabulary is closed and stable', () => {
  assert.deepEqual([...ENQUIRY_BUDGETS], ['under-10', '10-15', '15-20', '20-plus', 'custom']);
});
