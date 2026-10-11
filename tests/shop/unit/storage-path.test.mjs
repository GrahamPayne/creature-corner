import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniqueImagePath, uniqueGalleryImagePath } from '../../../src/features/shop/admin/storagePath.js';

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

test('uniqueGalleryImagePath: builds a path scoped under gallery/, no per-product namespace needed', () => {
  const path = uniqueGalleryImagePath();
  assert.match(path, /^gallery\/[^/]+\.webp$/);
});

test('uniqueGalleryImagePath: uses the given extension', () => {
  const path = uniqueGalleryImagePath('jpg');
  assert.match(path, /\.jpg$/);
});

test('uniqueGalleryImagePath: generates unique paths across repeated calls', () => {
  const paths = new Set(Array.from({ length: 50 }, () => uniqueGalleryImagePath()));
  assert.equal(paths.size, 50);
});
