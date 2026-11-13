import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSequenceNumber,
  parseSequenceSuffix,
  nextSequenceStart,
  generateSequentialNames,
} from '../../../src/features/shop/admin/batchNaming.js';

test('formatSequenceNumber pads to 3 digits, grows past 999 unpadded', () => {
  assert.equal(formatSequenceNumber(1), '001');
  assert.equal(formatSequenceNumber(31), '031');
  assert.equal(formatSequenceNumber(999), '999');
  assert.equal(formatSequenceNumber(1000), '1000');
});

test('parseSequenceSuffix matches "<base>-NNN" case-insensitively', () => {
  assert.equal(parseSequenceSuffix('Creature Lighter-007', 'Creature Lighter'), 7);
  assert.equal(parseSequenceSuffix('creature lighter-007', 'CREATURE LIGHTER'), 7);
});

test('parseSequenceSuffix rejects names outside this base\'s sequence', () => {
  assert.equal(parseSequenceSuffix('Creature Mask-001', 'Creature Lighter'), null);
  assert.equal(parseSequenceSuffix('Creature Lighter', 'Creature Lighter'), null);
  assert.equal(parseSequenceSuffix('Creature Lighter-abc', 'Creature Lighter'), null);
  assert.equal(parseSequenceSuffix('Creature Lighter-007 (Custom)', 'Creature Lighter'), null);
});

test('nextSequenceStart returns 1 when nothing matches yet', () => {
  assert.equal(nextSequenceStart(['Random Mask', 'Other-002'], 'Creature Lighter'), 1);
});

test('nextSequenceStart continues from the highest existing suffix, ignoring gaps from deletions', () => {
  const existing = ['Creature Lighter-001', 'Creature Lighter-003', 'Creature Lighter-030', 'Unrelated Product'];
  assert.equal(nextSequenceStart(existing, 'Creature Lighter'), 31);
});

test('nextSequenceStart is unaffected by other bases sharing a numeric suffix', () => {
  const existing = ['Creature Mask-050', 'Creature Lighter-002'];
  assert.equal(nextSequenceStart(existing, 'Creature Lighter'), 3);
});

test('generateSequentialNames produces zero-padded sequential names starting at the given number', () => {
  assert.deepEqual(generateSequentialNames('Creature Lighter', 4, 1), [
    'Creature Lighter-001',
    'Creature Lighter-002',
    'Creature Lighter-003',
    'Creature Lighter-004',
  ]);
});

test('generateSequentialNames keeps counting past 999 without breaking', () => {
  const names = generateSequentialNames('Creature Lighter', 3, 998);
  assert.deepEqual(names, ['Creature Lighter-998', 'Creature Lighter-999', 'Creature Lighter-1000']);
});
