/**
 * Central action dispatcher — the single navigation system.
 * Typed terminal commands AND physical controls (orange buttons, side
 * buttons, jog wheel, power button) all dispatch the same actions here.
 */

import { CATEGORIES, recordsInCategory, findRecord } from '../data/records.js';
import {
  BOOT_LINES,
  SHUTDOWN_LINES,
  HELP_LINES,
  UNKNOWN_RESPONSES,
  CHAT_RESPONSES,
  MESSAGES,
} from '../data/responses.js';

/** @typedef {import('../types/typedefs.js').FgAction} FgAction */

/** Default timings (ms). main.js shrinks these under prefers-reduced-motion. */
export const DEFAULT_DURATIONS = {
  pressFlash: 260,
  bootLightDelay: 200,
  bootScreenDelay: 550,
  bootDone: 1300,
  returning: 200,
  shutdownDone: 850,
};

/**
 * @param {ReturnType<typeof import('../state/store.js').createStore>} store
 * @param {{
 *   print: (lines: string[]) => void,
 *   clear: () => void,
 *   effects?: {
 *     powerPress?: () => void,
 *     deadPress?: () => void,
 *     screenFlicker?: () => void,
 *   },
 *   durations?: typeof DEFAULT_DURATIONS,
 *   schedule?: (fn: () => void, ms: number) => void,
 * }} io
 */
export function createDispatcher(store, io) {
  const print = io.print;
  const clear = io.clear;
  const fx = io.effects || {};
  const T = io.durations || DEFAULT_DURATIONS;
  const schedule = io.schedule || ((fn, ms) => setTimeout(fn, ms));

  let unknownCounter = 0;

  const isBusy = () => {
    const d = store.get().device;
    return d === 'booting' || d === 'shuttingDown' || d === 'returning';
  };

  function powerOn() {
    fx.powerPress?.();
    store.set({ device: 'booting' });
    schedule(() => fx.screenFlicker?.(), T.bootScreenDelay);
    schedule(() => {
      store.set({ device: 'mainMenu', category: null, recordId: null, selection: 0 });
      print(BOOT_LINES);
    }, T.bootDone);
  }

  function powerOff() {
    print(MESSAGES.poweringOff);
    print(SHUTDOWN_LINES);
    store.set({ device: 'shuttingDown' });
    schedule(() => {
      clear();
      store.set({ device: 'poweredOff', category: null, recordId: null, selection: 0 });
    }, T.shutdownDone);
  }

  /** Brief 'returning' transition, then land on the target view. */
  function transitionTo(patch) {
    store.set({ device: 'returning' });
    schedule(() => store.set(patch), T.returning);
  }

  function openCategory(categoryKey) {
    const cat = CATEGORIES[categoryKey];
    const items = recordsInCategory(categoryKey);
    store.set({ device: 'browsingIndex', category: categoryKey, recordId: null, selection: 0 });
    print([
      `${cat.label}: ${items.length} PROTOTYPE ENTRIES.`,
      'TYPE OPEN <ID> TO VIEW A RECORD.',
    ]);
  }

  function stepRecord(dir) {
    const s = store.get();
    if (s.device === 'viewingRecord' && s.category) {
      const items = recordsInCategory(s.category);
      const i = items.findIndex((r) => r.id === s.recordId);
      const next = i + dir;
      if (next < 0) return print(MESSAGES.startOfRecords);
      if (next >= items.length) return print(MESSAGES.endOfRecords);
      store.set({ recordId: items[next].id, selection: next });
      print([`RECORD ${items[next].id} OPENED.`]);
      return;
    }
    if (s.device === 'browsingIndex' && s.category) {
      const items = recordsInCategory(s.category);
      const next = Math.min(Math.max(s.selection + dir, 0), items.length - 1);
      store.set({ selection: next });
      return;
    }
    if (s.device === 'mainMenu') {
      const count = Object.keys(CATEGORIES).length;
      const next = (s.selection + dir + count) % count;
      store.set({ selection: next });
      return;
    }
    print(MESSAGES.nothingToNavigate);
  }

  /** @param {FgAction} action */
  function dispatch(action) {
    const s = store.get();

    // Powered off: only the power button responds.
    if (s.device === 'poweredOff') {
      if (action.type === 'POWER_TOGGLE' || action.type === 'POWER_ON') powerOn();
      else fx.deadPress?.();
      return;
    }

    if (isBusy()) return; // ignore input during transitions

    switch (action.type) {
      case 'NOOP':
        return;

      case 'POWER_TOGGLE':
      case 'POWER_OFF':
        fx.powerPress?.();
        powerOff();
        return;

      case 'HELP':
        print(HELP_LINES);
        return;

      case 'INDEX':
        transitionTo({ device: 'mainMenu', category: null, recordId: null, selection: 0 });
        print(MESSAGES.indexHint);
        return;

      case 'CATEGORY':
        if (action.category && CATEGORIES[action.category]) openCategory(action.category);
        return;

      case 'OPEN': {
        if (!action.id) return print(MESSAGES.openNeedsId);
        const record = findRecord(action.id);
        if (!record) return print(MESSAGES.noRecord);
        const items = recordsInCategory(record.category);
        store.set({
          device: 'viewingRecord',
          category: record.category,
          recordId: record.id,
          selection: items.findIndex((r) => r.id === record.id),
        });
        print([`RECORD ${record.id} OPENED.`]);
        return;
      }

      case 'NEXT':
        stepRecord(1);
        return;
      case 'PREV':
        stepRecord(-1);
        return;

      case 'BACK': {
        if (s.device === 'viewingRecord') {
          transitionTo({ device: 'browsingIndex', recordId: null });
          return;
        }
        if (s.device === 'browsingIndex') {
          transitionTo({ device: 'mainMenu', category: null, selection: 0 });
          print(MESSAGES.atMainMenu);
          return;
        }
        print(MESSAGES.alreadyHome);
        return;
      }

      case 'HOME':
        if (s.device === 'mainMenu') return print(MESSAGES.alreadyHome);
        transitionTo({ device: 'mainMenu', category: null, recordId: null, selection: 0 });
        print(MESSAGES.atMainMenu);
        return;

      case 'STATUS': {
        const cat = s.category ? CATEGORIES[s.category].label : 'NONE';
        print([
          'POWER: ON',
          `MODE: ${s.device.toUpperCase()}`,
          `CATEGORY: ${cat}`,
          `RECORD: ${s.recordId || 'NONE'}`,
        ]);
        return;
      }

      case 'CLEAR':
        clear();
        return;

      case 'CHAT': {
        const lines = action.key ? CHAT_RESPONSES[action.key] : null;
        if (lines) print(lines);
        return;
      }

      case 'UNKNOWN':
      default: {
        const lines = UNKNOWN_RESPONSES[unknownCounter % UNKNOWN_RESPONSES.length];
        unknownCounter += 1;
        print(lines);
        return;
      }
    }
  }

  return dispatch;
}
