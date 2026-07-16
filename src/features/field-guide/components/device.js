/**
 * Builds the device DOM: artwork layers stacked in PSD order, state
 * overlays, live screen mounts, and transparent hotspot buttons.
 * All geometry comes from data/layout.js (normalized PSD coordinates),
 * so nothing drifts when the device scales.
 */

import { ART_LAYERS, OVERLAYS, SCREENS, HOTSPOTS, JOG_REGION } from '../data/layout.js';

/** @param {{left:number, top:number, width:number, height:number}} b */
function place(el, b) {
  el.style.left = `${b.left * 100}%`;
  el.style.top = `${b.top * 100}%`;
  el.style.width = `${b.width * 100}%`;
  el.style.height = `${b.height * 100}%`;
}

/**
 * @param {HTMLElement} root
 * @returns {{
 *   powerlightOn: HTMLElement,
 *   powerPressed: HTMLElement,
 *   jogWheelImg: HTMLImageElement,
 *   jogHotspot: HTMLElement,
 *   mainScreenMount: HTMLElement,
 *   terminalMount: HTMLElement,
 *   hotspots: Record<string, HTMLButtonElement>,
 *   artEls: Record<string, HTMLImageElement>,
 * }}
 */
export function buildDevice(root) {
  root.classList.add('fg-device');

  /** @type {HTMLImageElement} */
  let jogWheelImg;
  /** @type {Record<string, HTMLImageElement>} */
  const artEls = {};

  for (const layer of ART_LAYERS) {
    const img = document.createElement('img');
    img.src = layer.src;
    img.alt = '';
    img.draggable = false;
    if (layer.rotates) {
      // wrap so rotation happens around the wheel's own center
      const wrap = document.createElement('div');
      wrap.className = 'fg-layer fg-jog-wrap';
      place(wrap, layer.bounds);
      img.className = 'fg-jog-img';
      wrap.appendChild(img);
      root.appendChild(wrap);
      jogWheelImg = img;
      artEls[layer.id] = img;
      continue;
    }
    img.className = `fg-layer fg-art-${layer.id}`;
    place(img, layer.bounds);
    root.appendChild(img);
    artEls[layer.id] = img;
  }

  // State overlays (composite crops with the PSD layer effects baked in)
  const powerlightOn = document.createElement('img');
  powerlightOn.src = OVERLAYS.powerlightOn.src;
  powerlightOn.alt = '';
  powerlightOn.draggable = false;
  powerlightOn.className = 'fg-layer fg-overlay fg-powerlight-on';
  place(powerlightOn, OVERLAYS.powerlightOn.bounds);
  root.appendChild(powerlightOn);

  const powerPressed = document.createElement('img');
  powerPressed.src = OVERLAYS.powerButtonPressed.src;
  powerPressed.alt = '';
  powerPressed.draggable = false;
  powerPressed.className = 'fg-layer fg-overlay fg-power-pressed';
  place(powerPressed, OVERLAYS.powerButtonPressed.bounds);
  root.appendChild(powerPressed);

  // Live screen mounts (HTML content over the drawn screen faces)
  const mainScreenMount = document.createElement('div');
  mainScreenMount.className = 'fg-layer fg-screen fg-screen-main';
  place(mainScreenMount, SCREENS.main);
  root.appendChild(mainScreenMount);

  const terminalMount = document.createElement('div');
  terminalMount.className = 'fg-layer fg-screen fg-screen-terminal';
  place(terminalMount, SCREENS.terminal);
  root.appendChild(terminalMount);

  // Transparent hotspot buttons over the drawn controls
  /** @type {Record<string, HTMLButtonElement>} */
  const hotspots = {};
  for (const spot of HOTSPOTS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `fg-layer fg-hotspot fg-hotspot-${spot.id}`;
    btn.setAttribute('aria-label', spot.label);
    place(btn, spot.bounds);
    root.appendChild(btn);
    hotspots[spot.id] = btn;
  }

  // Jog wheel interactive region (role=slider semantics, keyboard operable)
  const jogHotspot = document.createElement('div');
  jogHotspot.className = 'fg-layer fg-hotspot fg-hotspot-jog';
  jogHotspot.tabIndex = 0;
  jogHotspot.setAttribute('role', 'slider');
  jogHotspot.setAttribute('aria-label', 'Jog wheel: scroll through records');
  jogHotspot.setAttribute('aria-valuemin', '0');
  jogHotspot.setAttribute('aria-valuemax', '100');
  jogHotspot.setAttribute('aria-valuenow', '50');
  place(jogHotspot, JOG_REGION);
  root.appendChild(jogHotspot);

  // @ts-ignore - jogWheelImg assigned inside the loop (JOG_WHEEL layer always present)
  return { powerlightOn, powerPressed, jogWheelImg, jogHotspot, mainScreenMount, terminalMount, hotspots, artEls };
}
