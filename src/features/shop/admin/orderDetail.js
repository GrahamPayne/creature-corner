import { escapeHtml } from '../dom.js';
import { formatCents } from '../money.js';
import { canMarkFulfilled, canCancelOrder, canRefundOrder, canTransitionShipping, canTransitionFulfillment } from '../order/orderStates.js';

function formatAddress(address) {
  if (!address) return '—';
  const lines = [address.line1, address.line2, `${address.city || ''}, ${address.state || ''} ${address.zip || ''}`.trim()].filter(Boolean);
  return lines.map(escapeHtml).join('<br>');
}

const SHIPPING_STATUS_OPTIONS = ['label_not_purchased', 'label_created', 'shipped', 'in_transit', 'delivered', 'exception'];

/**
 * @param {any} order
 * @param {{
 *   onBack: () => void,
 *   onConfirmTestPayment: (id: string) => Promise<any>,
 *   onMarkFulfilled: (id: string) => Promise<any>,
 *   onMarkUnfulfilled: (id: string) => Promise<any>,
 *   onUpdateShippingStatus: (id: string, status: string) => Promise<any>,
 *   onUpdateTracking: (id: string, info: {carrier: string, service: string, trackingNumber: string}) => Promise<any>,
 *   onUpdateNotes: (id: string, notes: string) => Promise<any>,
 *   onCancel: (id: string, reason: string) => Promise<any>,
 *   onRefund: (id: string, amountCents: number|undefined, reason: string) => Promise<any>,
 *   onReload: () => void,
 *   events: {id:string, eventType:string, payload:any, createdBy:string, createdAt:string}[],
 * }} opts
 */
export function createOrderDetail(order, opts) {
  const { onBack, onConfirmTestPayment, onMarkFulfilled, onMarkUnfulfilled, onUpdateShippingStatus, onUpdateTracking, onUpdateNotes, onCancel, onRefund, onReload, events = [] } = opts;
  const el = document.createElement('div');

  async function guarded(action, confirmMessage) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    const errorEl = /** @type {HTMLElement} */ (el.querySelector('#order-detail-error'));
    errorEl.hidden = true;
    try {
      await action();
      onReload();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      errorEl.hidden = false;
    }
  }

  const shippingOptions = SHIPPING_STATUS_OPTIONS
    .map((key) => `<option value="${key}" ${order.shippingStatus === key ? 'selected' : ''} ${canTransitionShipping(order.shippingStatus, key) ? '' : 'disabled'}>${key.replace(/_/g, ' ')}</option>`)
    .join('');

  el.innerHTML = `
    <div class="admin-form-actions">
      <button type="button" class="admin-btn" data-action="back">&larr; Back to Orders</button>
    </div>

    <p class="admin-form-error" id="order-detail-error" hidden></p>

    <div class="admin-header">
      <h1>${escapeHtml(order.orderNumber || order.id)}</h1>
      ${order.testMode ? '<span class="admin-test-badge admin-test-badge-lg">TEST ORDER</span>' : ''}
    </div>

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">Customer</h2>
      <p>${escapeHtml(order.customerName || '—')}</p>
      <p>${escapeHtml(order.email || '—')}</p>
      <p>${escapeHtml(order.customerPhone || '—')}</p>
    </div>

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">Fulfillment</h2>
      <p>${order.fulfillmentType === 'pickup' ? 'Local Pickup' : 'Shipping'}</p>
    </div>

    ${order.fulfillmentType === 'shipping' ? `
      <div class="admin-form-section">
        <h2 class="admin-form-section-title">Shipping Address</h2>
        <p>${formatAddress(order.shippingAddress)}</p>
        ${order.billingAddress ? `<h2 class="admin-form-section-title" style="margin-top:12px">Billing Address</h2><p>${formatAddress(order.billingAddress)}</p>` : ''}
      </div>
    ` : ''}

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">Items</h2>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Image</th><th>Name</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr></thead>
          <tbody>
            ${order.items.map((item) => `
              <tr>
                <td class="admin-thumb-cell">${item.thumbnailUrl ? `<img src="${escapeHtml(item.thumbnailUrl)}" alt="" class="admin-thumb">` : '<span class="admin-thumb-placeholder">No image</span>'}</td>
                <td>${item.productSlug ? `<a href="/product/${escapeHtml(item.productSlug)}" target="_blank" rel="noopener">${escapeHtml(item.name)}</a>` : escapeHtml(item.name)}</td>
                <td>${item.quantity}</td>
                <td>${formatCents(item.unitPriceCents)}</td>
                <td>${formatCents(item.lineTotalCents)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">Totals</h2>
      <p>Subtotal: ${formatCents(order.subtotalCents)}</p>
      <p>Shipping: ${formatCents(order.shippingCents)}</p>
      ${order.taxCents ? `<p>Tax: ${formatCents(order.taxCents)}</p>` : ''}
      ${order.discountCents ? `<p>Discount: -${formatCents(order.discountCents)}</p>` : ''}
      <p><strong>Total: ${formatCents(order.totalCents)}</strong> ${escapeHtml((order.currency || 'usd').toUpperCase())}</p>
    </div>

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">Payment</h2>
      <p>Provider: ${escapeHtml(order.paymentProvider || '—')}</p>
      <p>Reference: ${escapeHtml(order.paymentReference || '—')}</p>
      <p>Status: <span class="admin-status admin-status-${order.paymentStatus}">${order.paymentStatus.replace(/_/g, ' ')}</span></p>
      ${order.paidAt ? `<p>Paid: ${new Date(order.paidAt).toLocaleString()}</p>` : ''}
      ${order.refundedAmountCents ? `<p>Refunded so far: ${formatCents(order.refundedAmountCents)} of ${formatCents(order.totalCents)}</p>` : ''}
      ${order.refundedAt ? `<p>Fully refunded: ${new Date(order.refundedAt).toLocaleString()}</p>` : ''}
      <div class="admin-form-actions">
        ${order.testMode && order.paymentStatus === 'pending' ? '<button type="button" class="admin-btn admin-btn-primary" data-action="confirm-test-payment">Confirm Test Payment</button>' : ''}
        ${canRefundOrder(order) ? `<button type="button" class="admin-btn admin-btn-danger" data-action="refund" ${order.testMode ? '' : 'disabled title="Refund real Stripe orders directly in the Stripe Dashboard for now — this button is Test Mode only. A refunded charge still reconciles into this order automatically (see the Stripe webhook)."'}>Refund</button>` : ''}
      </div>
    </div>

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">Fulfillment Status</h2>
      <p>Status: <span class="admin-status admin-status-${order.fulfillmentStatus}">${order.fulfillmentStatus}</span></p>
      ${order.fulfilledAt ? `<p>Fulfilled: ${new Date(order.fulfilledAt).toLocaleString()}</p>` : ''}
      <div class="admin-form-actions">
        <button type="button" class="admin-btn admin-btn-primary" data-action="mark-fulfilled" ${canMarkFulfilled(order) && canTransitionFulfillment(order.fulfillmentStatus, 'fulfilled') ? '' : 'disabled'} title="${canMarkFulfilled(order) ? '' : 'This order has not been paid yet'}">Mark Fulfilled</button>
        <button type="button" class="admin-btn" data-action="mark-unfulfilled" ${order.fulfillmentStatus === 'fulfilled' ? '' : 'disabled'}>Mark Unfulfilled</button>
        <button type="button" class="admin-btn admin-btn-danger" data-action="cancel" ${canCancelOrder(order) && order.fulfillmentStatus !== 'fulfilled' ? '' : 'disabled'}>Cancel Order</button>
      </div>
    </div>

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">Shipping</h2>
      <label>Shipping status
        <select id="shipping-status-select">${shippingOptions}</select>
      </label>
      <div class="admin-form-row">
        <label>Carrier <input type="text" id="tracking-carrier" value="${escapeHtml(order.shippingCarrier || '')}"></label>
        <label>Service <input type="text" id="tracking-service" value="${escapeHtml(order.shippingService || '')}"></label>
        <label>Tracking number <input type="text" id="tracking-number" value="${escapeHtml(order.trackingNumber || '')}"></label>
      </div>
      <p class="admin-notice">Manual entry only — no shipping-label provider is connected yet (see docs/ORDERS_FULFILLMENT_ARCHITECTURE.md).</p>
      <div class="admin-form-actions">
        <button type="button" class="admin-btn" data-action="save-tracking">Save Tracking Info</button>
        <button type="button" class="admin-btn" disabled title="No label provider connected yet">Buy Label</button>
        <button type="button" class="admin-btn" disabled title="No label provider connected yet">Print Label</button>
      </div>
    </div>

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">Notes</h2>
      <textarea id="order-notes" rows="3">${escapeHtml(order.notes || '')}</textarea>
      <div class="admin-form-actions">
        <button type="button" class="admin-btn" data-action="save-notes">Save Notes</button>
      </div>
    </div>

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">History</h2>
      ${events.length === 0
        ? '<p class="admin-notice">No events recorded yet.</p>'
        : `<ul class="admin-order-events">
            ${events.map((e) => `<li><strong>${escapeHtml(e.eventType)}</strong> — ${new Date(e.createdAt).toLocaleString()} (${escapeHtml(e.createdBy || 'system')})</li>`).join('')}
          </ul>`}
    </div>
  `;

  el.querySelector('[data-action="back"]').addEventListener('click', onBack);

  el.querySelector('[data-action="confirm-test-payment"]')?.addEventListener('click', () =>
    guarded(() => onConfirmTestPayment(order.id), 'Confirm this TEST order as paid? This never charges a real customer.')
  );

  el.querySelector('[data-action="mark-fulfilled"]')?.addEventListener('click', () =>
    guarded(() => onMarkFulfilled(order.id), `Mark ${order.orderNumber || 'this order'} as fulfilled?`)
  );

  el.querySelector('[data-action="mark-unfulfilled"]')?.addEventListener('click', () =>
    guarded(() => onMarkUnfulfilled(order.id), `Mark ${order.orderNumber || 'this order'} back to unfulfilled?`)
  );

  el.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
    const reason = window.prompt('Cancellation reason (optional):') || '';
    guarded(() => onCancel(order.id, reason), `Cancel ${order.orderNumber || 'this order'}? This cannot be undone.`);
  });

  el.querySelector('[data-action="refund"]')?.addEventListener('click', () => {
    if (!order.testMode) return;
    const reason = window.prompt('Refund reason (optional):') || '';
    guarded(() => onRefund(order.id, undefined, reason), `Refund ${order.orderNumber || 'this order'} in full? This never charges/refunds a real customer in Test Mode.`);
  });

  el.querySelector('#shipping-status-select')?.addEventListener('change', (e) => {
    const value = /** @type {HTMLSelectElement} */ (e.target).value;
    guarded(() => onUpdateShippingStatus(order.id, value));
  });

  el.querySelector('[data-action="save-tracking"]')?.addEventListener('click', () => {
    const carrier = /** @type {HTMLInputElement} */ (el.querySelector('#tracking-carrier')).value.trim();
    const service = /** @type {HTMLInputElement} */ (el.querySelector('#tracking-service')).value.trim();
    const trackingNumber = /** @type {HTMLInputElement} */ (el.querySelector('#tracking-number')).value.trim();
    guarded(() => onUpdateTracking(order.id, { carrier, service, trackingNumber }));
  });

  el.querySelector('[data-action="save-notes"]')?.addEventListener('click', () => {
    const notes = /** @type {HTMLTextAreaElement} */ (el.querySelector('#order-notes')).value;
    guarded(() => onUpdateNotes(order.id, notes));
  });

  return el;
}
