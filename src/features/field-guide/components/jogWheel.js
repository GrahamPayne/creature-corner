/**
 * Jog wheel interaction: mouse wheel over the wheel, click-drag,
 * touch-drag, and arrow keys when focused. Each detent dispatches the
 * same PREV/NEXT actions as the terminal. The drawn wheel rotates
 * slightly (disabled under prefers-reduced-motion).
 */

const STEP_PX = 36;      // drag distance per detent
const WHEEL_STEP = 1;    // one detent per wheel event burst
const DEG_PER_STEP = 9;  // subtle rotation only

/**
 * @param {HTMLElement} hotspot
 * @param {HTMLImageElement} wheelImg
 * @param {{ onStep: (dir: 1|-1) => void, reducedMotion: () => boolean }} opts
 */
export function attachJogWheel(hotspot, wheelImg, opts) {
  let angle = 0;

  /** @param {1|-1} dir */
  function step(dir) {
    if (!opts.reducedMotion()) {
      angle += dir * DEG_PER_STEP;
      wheelImg.style.transform = `rotate(${angle}deg)`;
    }
    opts.onStep(dir);
  }

  hotspot.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.deltaY === 0) return;
    step(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  // click / touch drag
  let dragging = false;
  let lastY = 0;
  let accum = 0;

  hotspot.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastY = e.clientY;
    accum = 0;
    hotspot.setPointerCapture(e.pointerId);
    hotspot.classList.add('is-dragging');
  });

  hotspot.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    accum += e.clientY - lastY;
    lastY = e.clientY;
    while (accum >= STEP_PX) { accum -= STEP_PX; step(1); }
    while (accum <= -STEP_PX) { accum += STEP_PX; step(-1); }
  });

  const endDrag = () => {
    dragging = false;
    hotspot.classList.remove('is-dragging');
  };
  hotspot.addEventListener('pointerup', endDrag);
  hotspot.addEventListener('pointercancel', endDrag);

  hotspot.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    }
  });
}
