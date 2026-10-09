import { escapeHtml } from '../dom.js';
import { formatCents } from '../money.js';

/** Stage 6.5: structure only. No label purchasing, no real payment status — all five actions stay disabled until Stage 7/8 wires them up. */
const FUTURE_ACTIONS = ['Print Label', 'Print Packing Slip', 'Mark Shipped', 'Mark Ready for Pickup', 'Mark Fulfilled'];

function formatAddress(address) {
  if (!address) return '—';
  const lines = [address.line1, address.line2, `${address.city || ''}, ${address.state || ''} ${address.zip || ''}`.trim()].filter(Boolean);
  return lines.map(escapeHtml).join('<br>');
}

/**
 * Pure render function — given an order object (shape from
 * admin/api.js's adminListOrders), returns the detail view element. Takes
 * no handlers yet: every action below is disabled for Stage 6.5.
 * @param {any} order
 * @param {{onBack: () => void}} opts
 */
export function createOrderDetail(order, { onBack }) {
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="admin-form-actions">
      <button type="button" class="admin-btn" data-action="back">&larr; Back to Orders</button>
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
                <td>${escapeHtml(item.name)}</td>
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
      <p><strong>Total: ${formatCents(order.totalCents)}</strong></p>
    </div>

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">Status</h2>
      <p><span class="admin-status admin-status-${order.status}">${order.status}</span></p>
    </div>

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">Future Actions</h2>
      <p class="admin-notice">Not available yet — these ship with Stage 7/8 (payments and fulfillment).</p>
      <div class="admin-form-actions">
        ${FUTURE_ACTIONS.map((label) => `<button type="button" class="admin-btn" disabled>${label}</button>`).join('')}
      </div>
    </div>
  `;

  el.querySelector('[data-action="back"]').addEventListener('click', onBack);
  return el;
}
