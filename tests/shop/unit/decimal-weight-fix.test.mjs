import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Source-level regression guard for the "0.76 oz" decimal-weight bug: a
// <input type="number"> with step="1" (or step="0.1") rejects values that
// don't land on that exact step grid, which is what produced the browser's
// "nearest valid values are 0 and 1" error. step="any" is the actual fix
// (not a workaround) — it removes the step-mismatch constraint entirely
// while min/max/type="number" still block negative and non-numeric input.
// This can't be driven through a real <input> without a DOM (productForm.js
// pulls in Supabase at module load, so it can't load in a plain harness —
// see batchUpload.js's decimal-weight live-input tests for that half of the
// coverage instead), so this checks the actual shipped markup string.

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
function read(relPath) {
  return readFileSync(path.join(root, relPath), 'utf8');
}

const DECIMAL_FIELDS = ['packedWeightLb', 'packedWeightOz', 'packageLengthIn', 'packageWidthIn', 'packageHeightIn'];
const FILES = ['src/features/shop/admin/productForm.js', 'src/features/shop/admin/batchUpload.js'];

for (const file of FILES) {
  test(`${file}: packed weight/dimension inputs accept fractional values (step="any")`, () => {
    const src = read(file);
    for (const field of DECIMAL_FIELDS) {
      const tags = src.match(new RegExp(`<input[^>]*\\b(?:name|data-field)="${field}"[^>]*>`, 'g')) || [];
      assert.ok(tags.length > 0, `expected to find an input for "${field}" in ${file}`);
      for (const tag of tags) {
        assert.match(tag, /step="any"/, `"${field}" input in ${file} must use step="any" to accept decimals like 0.76 — got: ${tag}`);
      }
    }
  });

  test(`${file}: quantity stays a whole-number field (step="1"), not loosened by the decimal fix`, () => {
    const src = read(file);
    const tags = src.match(/<input[^>]*\b(?:name|data-field)="quantity"[^>]*>/g) || [];
    assert.ok(tags.length > 0, `expected to find a quantity input in ${file}`);
    for (const tag of tags) {
      assert.match(tag, /step="1"/, `quantity input in ${file} should remain step="1" (whole units) — got: ${tag}`);
    }
  });
}
