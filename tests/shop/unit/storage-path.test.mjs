import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniqueImagePath } from '../../../src/features/shop/admin/storagePath.js';

test('builds a path scoped under products/<productId>/', () => {
  const path = uniqueImagePath('abc-123');
  assert.match(path, /^products\/abc-123\/[^/]+\.webp$/);
});

test('uses the given extension', () => {
  const path = uniqueImagePath('abc-123', 'jpg');
  assert.match(path, /\.jpg$/);
});

test('generates unique paths across repeated calls', () => {
  const paths = new Set(Array.from({ length: 50 }, () => uniqueImagePath('same-product-id')));
  assert.equal(paths.size, 50);
});
