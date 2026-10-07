import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, uniqueSlug } from '../../../src/features/shop/admin/slug.js';

test('slugify lowercases and hyphenates', () => {
  assert.equal(slugify('Larval Mask No. 3'), 'larval-mask-no-3');
});

test('slugify strips apostrophes instead of turning them into hyphens', () => {
  assert.equal(slugify("Artist's Proof"), 'artists-proof');
});

test('slugify collapses repeated separators and trims leading/trailing hyphens', () => {
  assert.equal(slugify('  Weird --- Spacing!!  '), 'weird-spacing');
});

test('slugify handles empty/undefined input', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify(undefined), '');
});

test('uniqueSlug returns the base slug when free', () => {
  assert.equal(uniqueSlug('New Mask', () => false), 'new-mask');
});

test('uniqueSlug increments a numeric suffix until free', () => {
  const taken = new Set(['new-mask', 'new-mask-2', 'new-mask-3']);
  assert.equal(uniqueSlug('New Mask', (s) => taken.has(s)), 'new-mask-4');
});

test('uniqueSlug falls back to "item" for an empty base', () => {
  assert.equal(uniqueSlug('', () => false), 'item');
});
