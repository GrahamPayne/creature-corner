import { escapeHtml } from '../dom.js';

/**
 * Safe Test Mode's order-creation tool (section J) — admin-only, reachable
 * only from inside Admin -> Orders. Creates a real, persistent order row
 * via adminCreateOrdersApi's adminCreateTestOrder — exercising the actual
 * inventory-reservation and order-creation code a real checkout will use —
 * but always with payment_provider: 'test', test_mode: true, and
 * payment_status starting at 'pending', never auto-paid. Never reachable
 * from the public /shop or /cart pages.
 *
 * @param {{products: any[], onCreate: (fields: any) => Promise<any>, onCancel: () => void, onDone: () => void}} opts
 */
export function createTestOrderForm({ products, onCreate, onCancel, onDone }) {
  const form = document.createElement('form');
  form.className = 'admin-form';

  const purchasable = products.filter((p) => p.quantity > 0 && p.status !== 'sold');
  const productOptions = purchasable
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)} — ${p.quantity} in stock</option>`)
    .join('');

  form.innerHTML = `
    <p class="admin-form-error" hidden></p>
    <p class="admin-notice">
      Creates a real order record marked <strong>TEST</strong> — reserves inventory and walks the
      full order lifecycle exactly like a real checkout will, but never charges a real customer,
      never sends a customer notification, and payment stays Pending until you explicitly confirm it.
    </p>

    ${purchasable.length === 0 ? '<p class="admin-empty">No in-stock products available to test against.</p>' : `
      <label>Product
        <select name="productId" required>${productOptions}</select>
      </label>
      <label>Quantity
        <input type="number" name="quantity" min="1" step="1" value="1" required>
      </label>
      <label>Customer name
        <input type="text" name="customerName" required value="Test Customer">
      </label>
      <label>Email
        <input type="email" name="email" required value="test@example.com">
      </label>
      <label>Fulfillment
        <select name="fulfillmentType">
          <option value="shipping">Shipping</option>
          <option value="pickup">Local Pickup</option>
        </select>
      </label>
    `}

    <div class="admin-form-actions">
      ${purchasable.length > 0 ? '<button type="submit" class="admin-btn admin-btn-primary">Create Test Order</button>' : ''}
      <button type="button" class="admin-btn" data-action="cancel">Cancel</button>
    </div>
  `;

  const errorEl = /** @type {HTMLElement} */ (form.querySelector('.admin-form-error'));
  form.querySelector('[data-action="cancel"]').addEventListener('click', onCancel);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const data = new FormData(form);
    const quantity = Number(data.get('quantity'));
    const product = purchasable.find((p) => p.id === data.get('productId'));
    if (product && quantity > product.quantity) {
      errorEl.textContent = `Only ${product.quantity} in stock.`;
      errorEl.hidden = false;
      return;
    }

    const submitBtn = /** @type {HTMLButtonElement} */ (form.querySelector('[type="submit"]'));
    submitBtn.disabled = true;
    try {
      await onCreate({
        items: [{ productId: String(data.get('productId')), quantity }],
        customerName: String(data.get('customerName') || '').trim(),
        email: String(data.get('email') || '').trim(),
        fulfillmentType: String(data.get('fulfillmentType')),
        shippingAddress: { line1: '123 Test St', city: 'Testville', state: 'CA', zip: '90000' },
      });
      onDone();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Something went wrong creating the test order.';
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });

  return form;
}
