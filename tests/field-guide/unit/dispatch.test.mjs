import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../../src/features/field-guide/state/store.js';
import { createDispatcher } from '../../../src/features/field-guide/commands/dispatch.js';
import { parse } from '../../../src/features/field-guide/commands/parser.js';

/** Test harness: synchronous scheduler so timed transitions settle instantly. */
function makeDevice() {
  const store = createStore();
  /** @type {string[]} */
  const output = [];
  let cleared = 0;
  const dispatch = createDispatcher(store, {
    print: (lines) => output.push(...lines),
    clear: () => { cleared += 1; output.length = 0; },
    schedule: (fn) => fn(),
  });
  const type = (raw) => dispatch(parse(raw));
  return { store, output, dispatch, type, clearedCount: () => cleared };
}

let d;
beforeEach(() => { d = makeDevice(); });

test('loads powered off; typed commands do nothing until powered on', () => {
  assert.equal(d.store.get().device, 'poweredOff');
  d.type('HELP');
  assert.equal(d.output.length, 0);
});

test('power on boots to the main menu and prints the startup text', () => {
  d.dispatch({ type: 'POWER_TOGGLE' });
  assert.equal(d.store.get().device, 'mainMenu');
  assert.ok(d.output.join('\n').includes('FIELD GUIDE INTERFACE'));
  assert.ok(d.output.join('\n').includes('TYPE HELP FOR AVAILABLE COMMANDS'));
});

test('POWER OFF returns to poweredOff and clears the terminal', () => {
  d.dispatch({ type: 'POWER_TOGGLE' });
  d.type('power off');
  assert.equal(d.store.get().device, 'poweredOff');
  assert.equal(d.output.length, 0); // history cleared on shutdown
});

test('HELP lists available inputs', () => {
  d.dispatch({ type: 'POWER_TOGGLE' });
  d.type('help');
  assert.ok(d.output.join('\n').includes('AVAILABLE INPUTS'));
  assert.ok(d.output.join('\n').includes('OPEN <ID>'));
});

test('CREATURES / ARTIFACTS / MEMORIES open their indexes', () => {
  d.dispatch({ type: 'POWER_TOGGLE' });
  d.type('creatures');
  assert.equal(d.store.get().device, 'browsingIndex');
  assert.equal(d.store.get().category, 'creatures');
  d.type('artifacts');
  assert.equal(d.store.get().category, 'artifacts');
  d.type('memories');
  assert.equal(d.store.get().category, 'memories');
});

test('OPEN with a valid record shows it; invalid id is refused', () => {
  d.dispatch({ type: 'POWER_TOGGLE' });
  d.type('open TEST-CR-001');
  assert.equal(d.store.get().device, 'viewingRecord');
  assert.equal(d.store.get().recordId, 'TEST-CR-001');
  d.type('open TEST-XX-999');
  assert.ok(d.output.join('\n').includes('NO MATCHING RECORD WAS LOCATED.'));
  assert.equal(d.store.get().recordId, 'TEST-CR-001'); // unchanged
});

test('NEXT / PREV step through records with end notices', () => {
  d.dispatch({ type: 'POWER_TOGGLE' });
  d.type('open TEST-CR-001');
  d.type('next');
  assert.equal(d.store.get().recordId, 'TEST-CR-002');
  d.type('previous');
  assert.equal(d.store.get().recordId, 'TEST-CR-001');
  d.type('prev');
  assert.ok(d.output.join('\n').includes('START OF RECORDS.'));
});

test('BACK walks record -> index -> main menu', () => {
  d.dispatch({ type: 'POWER_TOGGLE' });
  d.type('open TEST-AR-001');
  d.type('back');
  assert.equal(d.store.get().device, 'browsingIndex');
  d.type('go back');
  assert.equal(d.store.get().device, 'mainMenu');
});

test('HOME returns to the main menu from anywhere', () => {
  d.dispatch({ type: 'POWER_TOGGLE' });
  d.type('open TEST-ME-001');
  d.type('main menu');
  assert.equal(d.store.get().device, 'mainMenu');
  assert.equal(d.store.get().category, null);
});

test('CLEAR empties the terminal history', () => {
  d.dispatch({ type: 'POWER_TOGGLE' });
  d.type('help');
  d.type('clear');
  assert.equal(d.output.length, 0);
});

test('physical button actions equal typed commands', () => {
  d.dispatch({ type: 'POWER_TOGGLE' });
  // Orange button 1 dispatches the same action object shape as typing CREATURES
  d.dispatch({ type: 'CATEGORY', category: 'creatures' });
  const viaButton = { ...d.store.get() };
  d.type('home');
  d.type('creatures');
  const viaTyping = d.store.get();
  assert.equal(viaButton.device, viaTyping.device);
  assert.equal(viaButton.category, viaTyping.category);
  assert.equal(viaButton.selection, viaTyping.selection);
});

test('unknown commands get a controlled response', () => {
  d.dispatch({ type: 'POWER_TOGGLE' });
  d.type('do a barrel roll');
  assert.ok(d.output.join('\n').includes('COMMAND NOT RECOGNIZED.'));
});

test('STATUS reports the current mode', () => {
  d.dispatch({ type: 'POWER_TOGGLE' });
  d.type('creatures');
  d.type('status');
  const text = d.output.join('\n');
  assert.ok(text.includes('POWER: ON'));
  assert.ok(text.includes('MODE: BROWSINGINDEX'));
});
