/**
 * Bounded-concurrency batch runner with per-item state tracking. No DOM, no
 * network — `createOne` is injected by the caller (batchUpload.js), which is
 * what actually talks to the existing product-creation API. This module only
 * owns scheduling, progress, and the retry/double-submit safety rules:
 *
 * - run() only ever processes items still in the 'pending' state, so calling
 *   it again after a full pass (double submission) is a safe no-op, and a
 *   second overlapping call while already running is ignored.
 * - retryFailed() only reprocesses items in the 'failed' state, so a
 *   product whose createOne() already succeeded is never recreated.
 *
 * Whether a *partial* per-item failure (e.g. product row created but its
 * image upload failed) can safely retry without duplicating the product row
 * is createOne's responsibility — it's given the same item object on every
 * attempt, so it can stash progress (e.g. `item.createdProduct`) on it and
 * skip already-done steps.
 *
 * @param {{
 *   items: {id: string}[],
 *   createOne: (item: any) => Promise<any>,
 *   concurrency?: number,
 *   onItemUpdate?: (state: {id: string, status: string, result?: any, error?: string|null}) => void,
 * }} opts
 */
export function createBatchRunner({ items, createOne, concurrency = 3, onItemUpdate = () => {} }) {
  const states = new Map(items.map((item) => [item.id, { id: item.id, status: 'pending', result: null, error: null }]));
  const byId = new Map(items.map((item) => [item.id, item]));
  let running = false;

  function setState(id, patch) {
    const next = { ...states.get(id), ...patch };
    states.set(id, next);
    onItemUpdate(next);
  }

  async function runPool(ids) {
    let cursor = 0;
    async function worker() {
      while (cursor < ids.length) {
        const id = ids[cursor];
        cursor += 1;
        setState(id, { status: 'running', error: null });
        try {
          const result = await createOne(byId.get(id));
          setState(id, { status: 'done', result, error: null });
        } catch (err) {
          setState(id, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    const workerCount = Math.max(1, Math.min(concurrency, ids.length));
    await Promise.all(Array.from({ length: workerCount }, worker));
  }

  function getSummary() {
    const all = items.map((item) => states.get(item.id));
    return {
      succeeded: all.filter((s) => s.status === 'done').length,
      failed: all.filter((s) => s.status === 'failed').length,
      pending: all.filter((s) => s.status === 'pending').length,
      states: all,
    };
  }

  async function run() {
    if (running) return getSummary();
    running = true;
    try {
      const pendingIds = items.map((i) => i.id).filter((id) => states.get(id).status === 'pending');
      await runPool(pendingIds);
      return getSummary();
    } finally {
      running = false;
    }
  }

  async function retryFailed() {
    if (running) return getSummary();
    running = true;
    try {
      const failedIds = items.map((i) => i.id).filter((id) => states.get(id).status === 'failed');
      await runPool(failedIds);
      return getSummary();
    } finally {
      running = false;
    }
  }

  return { run, retryFailed, getSummary, isRunning: () => running };
}
