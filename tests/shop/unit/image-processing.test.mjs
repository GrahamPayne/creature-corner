import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateImageFile,
  computeResizedDimensions,
  ACCEPTED_IMAGE_TYPES,
  MAX_FILE_BYTES,
  MAX_LONG_EDGE,
} from '../../../src/features/shop/admin/imageProcessing.js';

// validateImageFile/computeResizedDimensions only read plain properties, so
// plain objects stand in for File instances here — no DOM needed.

test('accepts jpg, jpeg, png, and webp', () => {
  for (const type of ACCEPTED_IMAGE_TYPES) {
    const result = validateImageFile({ type, size: 1000, name: 'photo' });
    assert.equal(result.ok, true, `expected ${type} to be accepted`);
  }
});

test('rejects an unsupported file type with a clear message', () => {
  const result = validateImageFile({ type: 'application/pdf', size: 1000, name: 'specs.pdf' });
  assert.equal(result.ok, false);
  assert.match(result.error, /specs\.pdf/);
  assert.match(result.error, /JPG|PNG|WebP/i);
});

test('rejects a file over the size limit with a clear message', () => {
  const result = validateImageFile({ type: 'image/jpeg', size: MAX_FILE_BYTES + 1, name: 'huge.jpg' });
  assert.equal(result.ok, false);
  assert.match(result.error, /huge\.jpg/);
  assert.match(result.error, /10MB/);
});

test('accepts a file exactly at the size limit', () => {
  const result = validateImageFile({ type: 'image/png', size: MAX_FILE_BYTES, name: 'ok.png' });
  assert.equal(result.ok, true);
});

test('computeResizedDimensions leaves images at or under the max long edge untouched', () => {
  assert.deepEqual(computeResizedDimensions(1200, 800, MAX_LONG_EDGE), { width: 1200, height: 800 });
  assert.deepEqual(computeResizedDimensions(2200, 1000, MAX_LONG_EDGE), { width: 2200, height: 1000 });
});

test('computeResizedDimensions downscales a wide image preserving aspect ratio', () => {
  const result = computeResizedDimensions(4400, 2200, MAX_LONG_EDGE);
  assert.equal(result.width, 2200);
  assert.equal(result.height, 1100);
});

test('computeResizedDimensions downscales a tall image preserving aspect ratio', () => {
  const result = computeResizedDimensions(2000, 4400, MAX_LONG_EDGE);
  assert.equal(result.height, 2200);
  assert.equal(result.width, 1000);
});

test('computeResizedDimensions never upscales a smaller source image', () => {
  assert.deepEqual(computeResizedDimensions(500, 300, MAX_LONG_EDGE), { width: 500, height: 300 });
});
