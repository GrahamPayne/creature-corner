import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPrimaryImage } from '../../../src/features/shop/primaryImage.js';

test('returns the image flagged isPrimary when one exists', () => {
  const images = [
    { url: 'a', isPrimary: false },
    { url: 'b', isPrimary: true },
    { url: 'c', isPrimary: false },
  ];
  assert.equal(pickPrimaryImage(images).url, 'b');
});

test('falls back to the first image by order when none is flagged primary', () => {
  const images = [
    { url: 'first', isPrimary: false },
    { url: 'second', isPrimary: false },
  ];
  assert.equal(pickPrimaryImage(images).url, 'first');
});

test('returns null for an empty images array (callers show the No Image placeholder)', () => {
  assert.equal(pickPrimaryImage([]), null);
});

test('returns null for undefined images', () => {
  assert.equal(pickPrimaryImage(undefined), null);
});

test('if two images are ever both flagged primary (shouldn\'t happen), picks the first one found rather than throwing', () => {
  const images = [
    { url: 'first-primary', isPrimary: true },
    { url: 'second-primary', isPrimary: true },
  ];
  assert.equal(pickPrimaryImage(images).url, 'first-primary');
});
