/**
 * PG Hunter — listing payload tests.
 *
 * One parser now serves both creation flows: an owner creating their own page
 * and an admin setting a page up on an owner's behalf. Whatever it accepts goes
 * straight into D1 for both, so the rules are tested here rather than through
 * two separate forms:
 *
 *   1. A PG must have a name and at least one room with a real rent — the two
 *      things a student is actually comparing.
 *   2. Bad numeric input never becomes a NaN rent in the database.
 *   3. Unattached photos are de-duplicated and capped, so one request cannot
 *      claim an unbounded batch of media rows.
 *
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_ROOMS, parseListingPayload } from '../src/lib/server/listingInput.ts';

const baseRoom = { roomType: 'double', occupancy: 'Double sharing', rent: 8500 };

const ok = (body: any) => {
  const result = parseListingPayload(body);
  assert.equal(result.ok, true, result.ok === false ? result.error : 'expected a valid payload');
  return result.ok ? result.value : null;
};

test('a valid payload keeps what the form sent', () => {
  const value = ok({
    name: '  Sunrise Boys PG  ',
    propertyType: 'pg',
    gender: 'boys',
    address: 'C-9/56, Rohini',
    locality: 'Rohini',
    city: 'Delhi',
    description: 'Quiet lane, 5 min walk to the metro.',
    rules: ['No smoking', '  '],
    curfew: '11:00 PM',
    food: { available: true, type: 'veg', monthlyCost: 2500 },
    amenitySlugs: ['wifi', 'ac'],
    rooms: [baseRoom],
    pendingMediaIds: ['photo-1', 'photo-2'],
  })!;

  assert.equal(value.name, 'Sunrise Boys PG');
  assert.equal(value.city, 'Delhi');
  assert.deepEqual(value.rules, ['No smoking']);
  assert.deepEqual(value.amenitySlugs, ['wifi', 'ac']);
  assert.deepEqual(value.pendingMediaIds, ['photo-1', 'photo-2']);
  assert.equal(value.food.available, true);
  assert.equal(value.food.monthlyCost, 2500);
});

test('defaults fill in for an owner who only typed the essentials', () => {
  const value = ok({ name: 'Basic PG', rooms: [{ rent: 5000 }] })!;
  assert.equal(value.propertyType, 'pg');
  assert.equal(value.gender, 'co-ed');
  assert.equal(value.city, 'Delhi');
  assert.equal(value.address, '');
  assert.deepEqual(value.rules, []);
  assert.equal(value.curfew, null);
  assert.equal(value.food.available, false);
  assert.equal(value.rooms[0].roomType, 'double');
  assert.equal(value.rooms[0].deposit, 0);
  assert.equal(value.rooms[0].available, 1);
});

test('a nameless PG is refused', () => {
  for (const name of [undefined, '', '   ', 42, null]) {
    const result = parseListingPayload({ name, rooms: [baseRoom] });
    assert.equal(result.ok, false, `name ${JSON.stringify(name)} should be refused`);
    assert.match(result.ok === false ? result.error : '', /name for the PG/);
  }
});

test('a PG with no rooms is refused', () => {
  const result = parseListingPayload({ name: 'Empty PG', rooms: [] });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : '', /at least one room/);
});

test('a room without a usable rent is refused', () => {
  for (const rent of [undefined, null, 'free', NaN, -1]) {
    const result = parseListingPayload({ name: 'PG', rooms: [{ rent }] });
    assert.equal(result.ok, false, `rent ${String(rent)} should be refused`);
    assert.match(result.ok === false ? result.error : '', /valid monthly rent/);
  }
});

test('a free-looking zero rent stays accepted — some PGs quote on enquiry', () => {
  const value = ok({ name: 'PG', rooms: [{ rent: 0 }] })!;
  assert.equal(value.rooms[0].rent, 0);
});

test('room count is capped so one request cannot write an unbounded batch', () => {
  const rooms = Array.from({ length: MAX_ROOMS }, () => baseRoom);
  assert.equal(parseListingPayload({ name: 'Big PG', rooms }).ok, true);

  const tooMany = Array.from({ length: MAX_ROOMS + 1 }, () => baseRoom);
  const result = parseListingPayload({ name: 'Huge PG', rooms: tooMany });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : '', new RegExp(`more than ${MAX_ROOMS} rooms`));
});

test('unattached photo ids are de-duplicated, trimmed and capped', () => {
  const value = ok({
    name: 'PG',
    rooms: [baseRoom],
    pendingMediaIds: [' photo-1 ', 'photo-1', '', 'photo-2', 7, null],
  })!;
  assert.deepEqual(value.pendingMediaIds, ['photo-1', 'photo-2']);

  const many = Array.from({ length: 100 }, (_, i) => `photo-${i}`);
  const capped = ok({ name: 'PG', rooms: [baseRoom], pendingMediaIds: many })!;
  assert.equal(capped.pendingMediaIds.length, 30);
});

test('optional text fields are trimmed rather than trusted', () => {
  const value = ok({
    name: 'PG',
    rooms: [baseRoom],
    address: '   12 Main Road   ',
    curfew: '   ',
    description: '  ',
    food: { available: false, type: '   ' },
  })!;
  assert.equal(value.address, '12 Main Road');
  assert.equal(value.curfew, null);
  assert.equal(value.description, '');
  assert.equal(value.food.type, undefined);
});

test('a malformed body cannot crash the parser', () => {
  for (const body of [undefined, null, 'nonsense', 42, []]) {
    const result = parseListingPayload(body);
    assert.equal(result.ok, false);
    assert.equal(typeof (result.ok === false ? result.error : ''), 'string');
  }
});
