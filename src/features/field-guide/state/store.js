/**
 * Minimal observable store for the Field Guide device state.
 * One source of truth; both the terminal and the physical controls
 * mutate it only through the dispatcher in commands/dispatch.js.
 */

/** @typedef {import('../types/typedefs.js').FgState} FgState */

/**
 * @param {Partial<FgState>} [initial]
 */
export function createStore(initial = {}) {
  /** @type {FgState} */
  const state = {
    device: 'poweredOff',
    terminalActive: false,
    category: null,
    recordId: null,
    selection: 0,
    ...initial,
  };

  /** @type {Set<(s: FgState) => void>} */
  const listeners = new Set();

  return {
    /** @returns {FgState} */
    get: () => state,

    /** @param {Partial<FgState>} patch */
    set(patch) {
      Object.assign(state, patch);
      listeners.forEach((fn) => fn(state));
    },

    /** @param {(s: FgState) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
