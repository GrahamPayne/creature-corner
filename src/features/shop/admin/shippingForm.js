const DISPLAY_ORDER = ['small', 'medium', 'large', 'oversized', 'pickup_only'];

/**
 * @param {{classes: {key:string, label:string, flatPriceCents:number|null}[], onSave: (rates: Record<string, number>) => Promise<void>, onBack: () => void}} opts
 */
export function createShippingForm({ classes, onSave, onBack }) {
  const ordered = DISPLAY_ORDER.map((key) => classes.find((c) => c.key === key)).filter(Boolean);

  const form = document.createElement('form');
  form.className = 'admin-form';
  form.innerHTML = `
    <p class="admin-form-error" hidden></p>
    <p class="admin-form-status" hidden></p>
    <p class="admin-notice">Flat shipping rate charged per order, based on the largest shipping class among its items. Local pickup is always free.</p>

    ${ordered
      .map((c) =>
        c.key === 'pickup_only'
          ? `<label>${c.label}
              <input type="text" value="$0.00 (always free)" disabled>
            </label>`
          : `<label>${c.label} shipping rate (USD)
              <input type="number" name="rate_${c.key}" min="0" step="0.01" value="${c.flatPriceCents === null ? '' : (c.flatPriceCents / 100).toFixed(2)}" placeholder="Not set">
            </label>`
      )
      .join('')}

    <div class="admin-form-actions">
      <button type="submit" class="admin-btn admin-btn-primary">Save Shipping Rates</button>
      <button type="button" class="admin-btn" data-action="back">Back</button>
    </div>
  `;

  const errorEl = /** @type {HTMLElement} */ (form.querySelector('.admin-form-error'));
  const statusEl = /** @type {HTMLElement} */ (form.querySelector('.admin-form-status'));

  form.querySelector('[data-action="back"]').addEventListener('click', onBack);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    statusEl.hidden = true;

    const data = new FormData(form);
    /** @type {Record<string, number>} */
    const rates = {};
    for (const c of ordered) {
      if (c.key === 'pickup_only') continue;
      const raw = data.get(`rate_${c.key}`);
      // Leaving a field blank is fine — it just stays unset (null) until
      // you come back and fill it in; never guess a number.
      if (raw === null || raw === '') continue;
      const dollars = Number(raw);
      if (!Number.isFinite(dollars) || dollars < 0) {
        errorEl.textContent = `${c.label} rate must be a non-negative number.`;
        errorEl.hidden = false;
        return;
      }
      rates[c.key] = Math.round(dollars * 100);
    }

    const submitBtn = /** @type {HTMLButtonElement} */ (form.querySelector('[type="submit"]'));
    submitBtn.disabled = true;
    try {
      await onSave(rates);
      statusEl.textContent = 'Shipping rates saved.';
      statusEl.hidden = false;
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Could not save shipping rates. Please try again.';
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });

  return form;
}
