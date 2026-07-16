/**
 * Field Guide prototype — entry point.
 * Wires the store, command parser, central dispatcher, artwork layers,
 * terminal, main screen, and physical controls together.
 *
 * Artwork: original work by Graham Payne (mockup PSD). This code only
 * presents it; it does not generate or alter the art.
 */

import { createStore } from './state/store.js';
import { parse } from './commands/parser.js';
import { createDispatcher, DEFAULT_DURATIONS } from './commands/dispatch.js';
import { buildDevice } from './components/device.js';
import { createTerminal } from './components/terminal.js';
import { createMainScreen } from './components/mainScreen.js';
import { attachJogWheel } from './components/jogWheel.js';

const root = document.getElementById('field-guide-device');
if (!root) throw new Error('Field Guide mount point #field-guide-device not found');

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => reducedMotionQuery.matches;

const durations = reducedMotion()
  ? { pressFlash: 80, bootLightDelay: 0, bootScreenDelay: 0, bootDone: 250, returning: 0, shutdownDone: 200 }
  : DEFAULT_DURATIONS;

const store = createStore();
const refs = buildDevice(root);
const mainScreen = createMainScreen(refs.mainScreenMount);

const terminal = createTerminal(refs.terminalMount, {
  onCommand: (raw) => dispatch(parse(raw)),
  onFocusChange: (focused) => {
    store.set({ terminalActive: focused });
    // On small screens, enlarge the terminal while typing so the on-screen
    // keyboard does not hide it; restored on blur.
    const small = window.matchMedia('(max-width: 700px)').matches;
    document.documentElement.classList.toggle('fg-terminal-zoom', focused && small);
  },
});

/** Brief pressed-state flash on the illustrated power button. */
function powerPressEffect() {
  refs.powerPressed.classList.add('is-visible');
  setTimeout(() => refs.powerPressed.classList.remove('is-visible'), durations.pressFlash);
}

/** Subtle response when a dead control is pressed while powered off. */
function deadPressEffect() {
  root.classList.remove('fg-dead-press');
  void root.offsetWidth; // restart the animation
  root.classList.add('fg-dead-press');
}

function screenFlickerEffect() {
  if (reducedMotion()) return;
  refs.mainScreenMount.classList.remove('fg-flicker');
  void refs.mainScreenMount.offsetWidth;
  refs.mainScreenMount.classList.add('fg-flicker');
}

const dispatch = createDispatcher(store, {
  print: (lines) => terminal.print(lines),
  clear: () => terminal.clear(),
  durations,
  effects: {
    powerPress: powerPressEffect,
    deadPress: deadPressEffect,
    screenFlicker: screenFlickerEffect,
  },
});

// ---- render on state change
store.subscribe((s) => {
  root.dataset.state = s.device;
  const on = s.device !== 'poweredOff';
  refs.powerlightOn.classList.toggle('is-visible', on);
  terminal.setEnabled(on && s.device !== 'booting' && s.device !== 'shuttingDown');
  mainScreen.render(s);
});

// ---- physical controls dispatch the SAME actions as typed commands
/** hotspot id -> drawn control sprite that shows the press state */
const PRESS_ART = {
  btn1: 'button-01',
  btn2: 'button-02',
  btn3: 'button-03',
  btn4: 'button-04',
  side1: 'sidebutton-1',
  side2: 'sidebutton-2',
};

const press = (btn, action) => {
  btn.addEventListener('click', () => dispatch(action));
  const artId = Object.entries(PRESS_ART).find(([id]) => refs.hotspots[id] === btn)?.[1];
  const art = artId ? refs.artEls[artId] : null;
  if (art) {
    btn.addEventListener('pointerdown', () => art.classList.add('is-pressed'));
    const release = () => art.classList.remove('is-pressed');
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('blur', release);
  }
};
press(refs.hotspots.power, { type: 'POWER_TOGGLE' });
press(refs.hotspots.btn1, { type: 'CATEGORY', category: 'creatures' });
press(refs.hotspots.btn2, { type: 'CATEGORY', category: 'artifacts' });
press(refs.hotspots.btn3, { type: 'CATEGORY', category: 'memories' });
press(refs.hotspots.btn4, { type: 'HOME' });
press(refs.hotspots.side1, { type: 'PREV' });
press(refs.hotspots.side2, { type: 'NEXT' });

attachJogWheel(refs.jogHotspot, refs.jogWheelImg, {
  onStep: (dir) => dispatch({ type: dir > 0 ? 'NEXT' : 'PREV' }),
  reducedMotion,
});

// Escape steps back a screen when focus is inside the device (never
// while typing in the terminal input, so text editing stays predictable).
root.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.activeElement !== terminal.input) {
    dispatch({ type: 'BACK' });
  }
});

// initial render (powered off)
store.set({});
