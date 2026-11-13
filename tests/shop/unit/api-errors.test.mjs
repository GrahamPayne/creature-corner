import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DUPLICATE_SLUG_MESSAGE, isDuplicateSlugError } from '../../../src/features/shop/admin/apiErrors.js';
import { isDuplicateSlugError as reExported } from '../../../src/features/shop/admin/api.js';

test('isDuplicateSlugError matches the exact message adminCreateProduct/adminUpdateProduct throw', () => {
  assert.equal(isDuplicateSlugError(new Error(DUPLICATE_SLUG_MESSAGE)), true);
});

test('isDuplicateSlugError rejects unrelated errors and non-Error values', () => {
  assert.equal(isDuplicateSlugError(new Error('some other failure')), false);
  assert.equal(isDuplicateSlugError('not an Error object'), false);
  assert.equal(isDuplicateSlugError(null), false);
});

test('api.js re-exports the same function apiErrors.js defines', () => {
  assert.equal(reExported, isDuplicateSlugError);
});
