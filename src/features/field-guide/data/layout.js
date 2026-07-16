/**
 * Field Guide device geometry, derived from the mockup PSD.
 * Source of truth: docs/PSD_LAYER_MANIFEST.md and
 * public/assets/field-guide/layer-manifest.json (regenerate with
 * `node scripts/extract-field-guide-psd.js` if the PSD changes).
 *
 * All bounds are normalized fractions of the PSD canvas (1086 x 1448)
 * so the interface scales without drifting.
 */

export const CANVAS = { width: 1086, height: 1448 };

const ASSET_BASE = 'public/assets/field-guide';

/** @param {number} l @param {number} t @param {number} r @param {number} b */
const px = (l, t, r, b) => ({
  left: l / CANVAS.width,
  top: t / CANVAS.height,
  width: (r - l) / CANVAS.width,
  height: (b - t) / CANVAS.height,
});

/**
 * Artwork layers, bottom -> top, matching the PSD stacking order.
 * The jog wheel sits BELOW the main body in the PSD (it tucks behind
 * the chassis edge), which is why it is a separate layer here.
 */
export const ART_LAYERS = [
  { id: 'terminal-body', src: `${ASSET_BASE}/sprites/terminal-body.png`, bounds: px(162, 713, 779, 1314) },
  { id: 'terminal-screen', src: `${ASSET_BASE}/sprites/terminal-screen.png`, bounds: px(291, 891, 743, 1115) },
  { id: 'jog-wheel', src: `${ASSET_BASE}/jog-wheel.png`, bounds: px(754, 421, 1044, 697), rotates: true },
  { id: 'main-body', src: `${ASSET_BASE}/sprites/main-body.png`, bounds: px(167, 57, 947, 723) },
  { id: 'main-screen', src: `${ASSET_BASE}/sprites/main-screen.png`, bounds: px(356, 283, 743, 578) },
  { id: 'sidebutton-1', src: `${ASSET_BASE}/sprites/sidebutton-1.png`, bounds: px(829, 272, 871, 312) },
  { id: 'sidebutton-2', src: `${ASSET_BASE}/sprites/sidebutton-2.png`, bounds: px(834, 339, 876, 379) },
  { id: 'button-01', src: `${ASSET_BASE}/sprites/button-01.png`, bounds: px(393, 259, 452, 275) },
  { id: 'button-02', src: `${ASSET_BASE}/sprites/button-02.png`, bounds: px(478, 258, 537, 274) },
  { id: 'button-03', src: `${ASSET_BASE}/sprites/button-03.png`, bounds: px(567, 259, 626, 275) },
  { id: 'button-04', src: `${ASSET_BASE}/sprites/button-04.png`, bounds: px(652, 259, 711, 275) },
  { id: 'powerlight-off', src: `${ASSET_BASE}/sprites/powerlight-off.png`, bounds: px(216, 202, 253, 239) },
];

/** State overlays (cropped from the Photoshop composite so layer effects/glow survive). */
export const OVERLAYS = {
  powerlightOn: { src: `${ASSET_BASE}/powerlight-on.png`, bounds: px(192, 178, 277, 263) },
  powerButtonPressed: { src: `${ASSET_BASE}/power-button-pressed.png`, bounds: px(194, 506, 321, 625) },
};

/** Live HTML screen regions, inset slightly from the drawn screen faces. */
export const SCREENS = {
  main: px(372, 296, 728, 566),
  terminal: px(305, 902, 730, 1104),
};

/**
 * Clickable regions. Small drawn controls get padded hit areas so they
 * remain tappable; the visible artwork is untouched.
 */
export const HOTSPOTS = [
  { id: 'power', label: 'Power button', bounds: px(212, 524, 303, 607) },
  { id: 'btn1', label: 'Orange button 1: creature records', bounds: px(387, 245, 458, 289) },
  { id: 'btn2', label: 'Orange button 2: artifact records', bounds: px(472, 244, 543, 288) },
  { id: 'btn3', label: 'Orange button 3: memory records', bounds: px(561, 245, 632, 289) },
  { id: 'btn4', label: 'Orange button 4: main menu', bounds: px(646, 245, 717, 289) },
  { id: 'side1', label: 'Side button 1: previous item', bounds: px(823, 266, 877, 318) },
  { id: 'side2', label: 'Side button 2: next item', bounds: px(828, 333, 882, 385) },
];

/** Jog wheel interactive region (drawn wheel bounds). */
export const JOG_REGION = px(754, 421, 1044, 697);
