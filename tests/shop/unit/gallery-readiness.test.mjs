import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getGalleryItemWarnings } from '../../../src/features/shop/admin/galleryReadiness.js';

test('a complete item (image + alt text) has no warnings', () => {
  assert.deepEqual(getGalleryItemWarnings({ storagePath: 'gallery/a.webp', altText: 'A specimen' }), []);
});

test('missing storagePath warns "Image missing"', () => {
  assert.deepEqual(getGalleryItemWarnings({ storagePath: null, altText: 'A specimen' }), ['Image missing']);
});

test('missing or blank alt text warns "Alt text missing"', () => {
  assert.deepEqual(getGalleryItemWarnings({ storagePath: 'gallery/a.webp', altText: null }), ['Alt text missing']);
  assert.deepEqual(getGalleryItemWarnings({ storagePath: 'gallery/a.webp', altText: '   ' }), ['Alt text missing']);
});

test('both missing produces both warnings', () => {
  assert.deepEqual(getGalleryItemWarnings({ storagePath: null, altText: '' }), ['Image missing', 'Alt text missing']);
});
