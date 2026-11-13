import { escapeHtml } from '../dom.js';
import { formatCents } from '../money.js';
import { deriveNeedsFulfillment } from './api.js';

/**
 * Filters read the new payment_status/fulfillment_status/shipping_status
 * columns (supabase/migrations/005_orders_fulfillment.sql) — none of
 * these are recomputed here beyond simple grouping, the columns
 * themselves are the source of truth now (legacy `status` stays on the
 * row for any pre-migration reader, but this UI no longer looks at it).
 */
const FILTERS = [
  ['all', 'All'],
  ['needs_fulfillment', 'Needs Fulfillment'],
  ['unpaid', 'Unpaid'],
  ['shipped', 'Shipped'],
  ['fulfilled', 'Fulfilled'],
  ['cancelled', 'Cancelled'],
  ['refunded', 'Refunded'],
  ['test', 'Test Orders'],
];

/** @param {any} order @param {string} filter */
export function orderMatchesFilter(order, filter) {
  switch (filter) {
    case 'all':
      return true;
    case 'needs_fulfillment':
      return deriveNeedsFulfillment(order);
    case 'unpaid':
      return order.paymentStatus === 'pending' || order.paymentStatus === 'failed';
    case 'shipped':
      return ['shipped', 'in_transit', 'delivered'].includes(order.shippingStatus);
    case 'fulfilled':
      return order.fulfillmentStatus === 'fulfilled';
    case 'cancelled':
      return order.fulfillmentStatus === 'cancelled' || order.paymentStatus === 'cancelled';
    case 'refunded':
      return order.paymentStatus === 'refunded' || order.paymentStatus === 'partially_refunded';
    case 'test':
      return order.testMode === true;
    default:
      return true;
  }
}

/** @param {any} order @param {string} query */
export function matchesSearch(order, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [order.orderNumber, order.customerName, order.email, order.id]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(q));
}

/**
 * @param {any[]} orders
 * @param {{onSelect: (id: string) => void}} opts
 */
export function createOrdersTable(orders, { onSelect }) {
  let activeFilter = 'all';
  let searchQuery = '';
  const wrap = document.createElement('div');

  function render() {
    if (orders.length === 0) {
      wrap.innerHTML = '<p class="admin-empty">No orders yet.</p>';
      return;
    }

    const filtered = orders.filter((o) => orderMatchesFilter(o, activeFilter) && matchesSearch(o, searchQuery));
    wrap.innerHTML = `
      <div class="admin-orders-toolbar">
        <input type="search" class="admin-orders-search" id="orders-search" placeholder="Search order #, customer, email…" value="${escapeHtml(searchQuery)}">
      </div>
      <div class="admin-filter-bar">
        ${FILTERS.map(
          ([key, label]) => `<button type="button" class="admin-btn-sm${activeFilter === key ? ' admin-btn-sm-active' : ''}" data-filter="${key}">${label}</button>`
        ).join('')}
      </div>
      ${filtered.length === 0
        ? '<p class="admin-empty">No orders match this filter.</p>'
        : `<div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr><th>Order #</th><th>Customer</th><th>Date</th><th>Items</th><th>Total</th><th>Payment</th><th>Fulfillment</th><th>Shipping</th></tr>
              </thead>
              <tbody>${filtered.map(renderRow).join('')}</tbody>
            </table>
          </div>`}
    `;
    wire();
  }

  function renderRow(order) {
    const customer = order.customerName || order.email || '—';
    const itemCount = order.items.reduce((sum, i) => sum + i.quantity, 0);
    return `
      <tr data-id="${order.id}" class="admin-row-clickable">
        <td>${escapeHtml(order.orderNumber || order.id.slice(0, 8))}${order.testMode ? ' <span class="admin-test-badge">TEST</span>' : ''}</td>
        <td>${escapeHtml(customer)}</td>
        <td>${new Date(order.createdAt).toLocaleDateString()}</td>
        <td>${itemCount}</td>
        <td>${formatCents(order.totalCents)}</td>
        <td><span class="admin-status admin-status-${order.paymentStatus}">${order.paymentStatus.replace(/_/g, ' ')}</span></td>
        <td><span class="admin-status admin-status-${order.fulfillmentStatus}">${order.fulfillmentStatus}</span></td>
        <td><span class="admin-status admin-status-${order.shippingStatus}">${order.shippingStatus.replace(/_/g, ' ')}</span></td>
      </tr>
    `;
  }

  function wire() {
    wrap.querySelectorAll('[data-filter]').forEach((btn) =>
      btn.addEventListener('click', () => {
        activeFilter = btn.getAttribute('data-filter');
        render();
      })
    );
    const search = /** @type {HTMLInputElement} */ (wrap.querySelector('#orders-search'));
    search?.addEventListener('input', () => {
      searchQuery = search.value;
      render();
    });
    wrap.querySelectorAll('tr[data-id]').forEach((row) =>
      row.addEventListener('click', () => onSelect(row.getAttribute('data-id')))
    );
  }

  render();
  return wrap;
}
