import { escapeHtml } from '../dom.js';
import { formatCents } from '../money.js';
import { deriveNeedsFulfillment } from './api.js';

/** Filters are computed client-side from existing orders.status/fulfillment_type — none of these are stored as their own column (see supabase/schema.sql). */
const FILTERS = [
  ['all', 'All'],
  ['needs_fulfillment', 'Needs Fulfillment'],
  ['shipping', 'Shipping'],
  ['pickup', 'Local Pickup'],
  ['fulfilled', 'Fulfilled'],
  ['cancelled', 'Cancelled'],
  ['refunded', 'Refunded'],
];

/** @param {any} order @param {string} filter */
export function orderMatchesFilter(order, filter) {
  switch (filter) {
    case 'all':
      return true;
    case 'needs_fulfillment':
      return deriveNeedsFulfillment(order);
    case 'shipping':
      return order.fulfillmentType === 'shipping';
    case 'pickup':
      return order.fulfillmentType === 'pickup';
    case 'fulfilled':
    case 'cancelled':
    case 'refunded':
      return order.status === filter;
    default:
      return true;
  }
}

/**
 * @param {any[]} orders
 * @param {{onSelect: (id: string) => void}} opts
 */
export function createOrdersTable(orders, { onSelect }) {
  let activeFilter = 'all';
  const wrap = document.createElement('div');

  function render() {
    if (orders.length === 0) {
      wrap.innerHTML = '<p class="admin-empty">No orders yet.</p>';
      return;
    }

    const filtered = orders.filter((o) => orderMatchesFilter(o, activeFilter));
    wrap.innerHTML = `
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
                <tr><th>Order</th><th>Customer</th><th>Fulfillment</th><th>Status</th><th>Total</th><th>Placed</th></tr>
              </thead>
              <tbody>${filtered.map(renderRow).join('')}</tbody>
            </table>
          </div>`}
    `;
    wire();
  }

  function renderRow(order) {
    const customer = order.customerName || order.email || '—';
    return `
      <tr data-id="${order.id}" class="admin-row-clickable">
        <td>${order.id.slice(0, 8)}</td>
        <td>${escapeHtml(customer)}</td>
        <td>${order.fulfillmentType === 'pickup' ? 'Local Pickup' : 'Shipping'}</td>
        <td><span class="admin-status admin-status-${order.status}">${order.status}</span></td>
        <td>${formatCents(order.totalCents)}</td>
        <td>${new Date(order.createdAt).toLocaleDateString()}</td>
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
    wrap.querySelectorAll('tr[data-id]').forEach((row) =>
      row.addEventListener('click', () => onSelect(row.getAttribute('data-id')))
    );
  }

  render();
  return wrap;
}
