/**
 * PG Hunter — role vocabulary tests.
 *
 * These protect the account-selection flow from two failure modes:
 *   1. a crafted value (e.g. `?role=admin`) being treated as a real role, and
 *   2. a genuine role mismatch being silently ignored instead of explained.
 *
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  USER_ROLES,
  isUserRole,
  isRoleMismatch,
  roleLabel,
  roleLanding,
  selectableRole,
} from '../src/lib/roles.ts';

test('only student and owner are user roles', () => {
  assert.deepEqual([...USER_ROLES], ['student', 'owner']);
  assert.equal(isUserRole('student'), true);
  assert.equal(isUserRole('owner'), true);
  assert.equal(isUserRole('admin'), false);
  assert.equal(isUserRole(''), false);
  assert.equal(isUserRole(null), false);
});

test('selectableRole rejects anything that is not a real role', () => {
  assert.equal(selectableRole('student'), 'student');
  assert.equal(selectableRole('owner'), 'owner');
  // A hostile value must not pass through as a role.
  assert.equal(selectableRole('admin'), null);
  assert.equal(selectableRole('OWNER'), null);
  assert.equal(selectableRole(undefined), null);
  assert.equal(selectableRole(123), null);
});

test('labels and landing paths are role-specific', () => {
  assert.equal(roleLabel('owner'), 'PG Owner');
  assert.equal(roleLabel('student'), 'Student');
  assert.equal(roleLanding('owner'), '/owner');
  assert.equal(roleLanding('student'), '/');
});

test('a mismatch is reported only for a non-admin with a different real role', () => {
  assert.equal(isRoleMismatch('owner', 'student', false), true);
  assert.equal(isRoleMismatch('student', 'owner', false), true);
  // Matching role is not a mismatch.
  assert.equal(isRoleMismatch('student', 'student', false), false);
  // No explicit selection means nothing to reconcile.
  assert.equal(isRoleMismatch(null, 'owner', false), false);
  // Admins are exempt from the prompt.
  assert.equal(isRoleMismatch('owner', 'student', true), false);
});
