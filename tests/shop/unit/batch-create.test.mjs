import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBatchRunner } from '../../../src/features/shop/admin/batchCreate.js';

function makeItems(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `item-${i}` }));
}

test('run() creates every item and reports a final summary', async () => {
  const items = makeItems(5);
  const calls = [];
  const runner = createBatchRunner({
    items,
    createOne: async (item) => {
      calls.push(item.id);
      return { id: item.id, created: true };
    },
  });
  const summary = await runner.run();
  assert.equal(summary.succeeded, 5);
  assert.equal(summary.failed, 0);
  assert.equal(calls.length, 5);
});

test('run() never exceeds the configured concurrency', async () => {
  const items = makeItems(10);
  let active = 0;
  let maxActive = 0;
  const runner = createBatchRunner({
    items,
    concurrency: 3,
    createOne: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return {};
    },
  });
  await runner.run();
  assert.ok(maxActive <= 3, `expected at most 3 concurrent, saw ${maxActive}`);
});

test('failed items are reported as failed, not thrown out of run()', async () => {
  const items = makeItems(4);
  const runner = createBatchRunner({
    items,
    createOne: async (item) => {
      if (item.id === 'item-1' || item.id === 'item-3') throw new Error(`boom ${item.id}`);
      return { id: item.id };
    },
  });
  const summary = await runner.run();
  assert.equal(summary.succeeded, 2);
  assert.equal(summary.failed, 2);
});

test('retryFailed() only re-invokes createOne for items that previously failed', async () => {
  const items = makeItems(3);
  const callCounts = {};
  let shouldFail = true;
  const runner = createBatchRunner({
    items,
    createOne: async (item) => {
      callCounts[item.id] = (callCounts[item.id] || 0) + 1;
      if (item.id === 'item-1' && shouldFail) throw new Error('transient failure');
      return { id: item.id };
    },
  });

  await runner.run();
  assert.equal(callCounts['item-0'], 1);
  assert.equal(callCounts['item-1'], 1);
  assert.equal(callCounts['item-2'], 1);

  shouldFail = false;
  const summary = await runner.retryFailed();
  assert.equal(summary.succeeded, 3);
  assert.equal(summary.failed, 0);
  // item-0 and item-2 already succeeded — retryFailed must not touch them again.
  assert.equal(callCounts['item-0'], 1);
  assert.equal(callCounts['item-2'], 1);
  assert.equal(callCounts['item-1'], 2);
});

test('calling run() again after a full successful pass is a safe no-op (double-submission guard)', async () => {
  const items = makeItems(3);
  let calls = 0;
  const runner = createBatchRunner({
    items,
    createOne: async (item) => {
      calls += 1;
      return { id: item.id };
    },
  });
  await runner.run();
  assert.equal(calls, 3);
  const summary = await runner.run();
  assert.equal(calls, 3, 'run() must not recreate already-succeeded items');
  assert.equal(summary.succeeded, 3);
});

test('an overlapping concurrent run() call while already running is ignored', async () => {
  const items = makeItems(3);
  let calls = 0;
  const runner = createBatchRunner({
    items,
    createOne: async (item) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { id: item.id };
    },
  });
  const first = runner.run();
  const second = runner.run();
  await Promise.all([first, second]);
  assert.equal(calls, 3, 'each item should only be created once even with an overlapping run() call');
});

test('onItemUpdate reports status transitions for both success and failure', async () => {
  const items = makeItems(2);
  const updates = [];
  const runner = createBatchRunner({
    items,
    createOne: async (item) => {
      if (item.id === 'item-1') throw new Error('nope');
      return { id: item.id };
    },
    onItemUpdate: (state) => updates.push({ ...state }),
  });
  await runner.run();
  const item0Updates = updates.filter((u) => u.id === 'item-0').map((u) => u.status);
  const item1Updates = updates.filter((u) => u.id === 'item-1').map((u) => u.status);
  assert.deepEqual(item0Updates, ['running', 'done']);
  assert.deepEqual(item1Updates, ['running', 'failed']);
});
