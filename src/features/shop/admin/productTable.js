import { formatCents } from '../money.js';
import { escapeHtml } from '../dom.js';
import { computeReadinessChecks, getReadinessStatus, getBlockingIssues } from './readiness.js';

const READINESS_LABELS = { ready: 'Ready', needs_info: 'Needs Info', draft: 'Draft' };

/**
 * @param {any[]} products
 * @param {{
 *   onEdit:(id:string)=>void, onDuplicate:(id:string)=>void, onDelete:(id:string)=>void,
 *   onQuickAction:(id:string, patch:object)=>void, onMessage?: (text:string)=>void,
 *   shippingRates?: Record<string, number|null>,
 * }} handlers
 */
export function createProductTable(products, { onEdit, onDuplicate, onDelete, onQuickAction, onMessage = () => {}, shippingRates = {} }) {
  const wrap = document.createElement('div');
  wrap.className = 'admin-table-wrap';

  if (products.length === 0) {
    wrap.innerHTML = '<p class="admin-empty">No products yet. Click "Add Product" to create the first one.</p>';
    return wrap;
  }

  const table = document.createElement('table');
  table.className = 'admin-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Image</th>
        <th>Name</th>
        <th>Price</th>
        <th>Category</th>
        <th>Qty</th>
        <th>Status</th>
        <th>Readiness</th>
        <th>Featured</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');

  // A status change to "Available" (the explicit button, or Publish via
  // toggle-visibility) must pass the same readiness gate productForm.js
  // enforces on submit — same rule, read from one place (readiness.js) —
  // so a product can't slip past the form's publish-safety check through
  // the table's quick actions instead.
  function guardedQuickAction(product, patch) {
    if (patch.status === 'available') {
      const checks = computeReadinessChecks({ ...product, status: 'available' }, { shippingRates });
      const blocking = getBlockingIssues(checks);
      if (blocking.length > 0) {
        onMessage(`Can't mark "${product.name}" Available yet — still needed: ${blocking.map((c) => c.label).join(', ')}.`);
        return;
      }
    }
    onQuickAction(product.id, patch);
  }

  for (const p of products) {
    const primary = p.images.find((i) => i.isPrimary) || p.images[0] || null;
    const checks = computeReadinessChecks(p, { shippingRates });
    const readiness = getReadinessStatus(p, checks);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="admin-thumb-cell">
        ${primary ? `<img src="${escapeHtml(primary.url)}" alt="" class="admin-thumb">` : '<span class="admin-thumb-placeholder">No image</span>'}
      </td>
      <td>${escapeHtml(p.name)}</td>
      <td>${formatCents(p.priceCents)}</td>
      <td>${escapeHtml(p.category?.name || '—')}</td>
      <td>${p.quantity}</td>
      <td><span class="admin-status admin-status-${p.status}">${p.status}</span></td>
      <td><span class="admin-readiness admin-readiness-${readiness}">${READINESS_LABELS[readiness]}</span></td>
      <td>${p.featured ? 'Yes' : 'No'}</td>
      <td class="admin-actions-cell">
        <button type="button" class="admin-btn-sm" data-act="edit">Edit</button>
        <button type="button" class="admin-btn-sm" data-act="duplicate">Duplicate</button>
        <button type="button" class="admin-btn-sm" data-act="sold">Mark Sold</button>
        <button type="button" class="admin-btn-sm" data-act="available">Mark Available</button>
        <button type="button" class="admin-btn-sm" data-act="toggle-visibility">${p.status === 'hidden' ? 'Publish' : 'Hide'}</button>
        <button type="button" class="admin-btn-sm" data-act="toggle-featured">${p.featured ? 'Unfeature' : 'Feature'}</button>
        <button type="button" class="admin-btn-sm admin-btn-danger" data-act="delete">Delete</button>
      </td>
    `;

    tr.querySelector('[data-act="edit"]').addEventListener('click', () => onEdit(p.id));
    tr.querySelector('[data-act="duplicate"]').addEventListener('click', () => onDuplicate(p.id));
    tr.querySelector('[data-act="sold"]').addEventListener('click', () => onQuickAction(p.id, { status: 'sold' }));
    tr.querySelector('[data-act="available"]').addEventListener('click', () => guardedQuickAction(p, { status: 'available' }));
    tr.querySelector('[data-act="toggle-visibility"]').addEventListener('click', () =>
      guardedQuickAction(p, { status: p.status === 'hidden' ? 'available' : 'hidden' })
    );
    tr.querySelector('[data-act="toggle-featured"]').addEventListener('click', () =>
      onQuickAction(p.id, { featured: !p.featured })
    );
    tr.querySelector('[data-act="delete"]').addEventListener('click', () => onDelete(p.id));

    tbody.appendChild(tr);
  }

  wrap.appendChild(table);
  return wrap;
}
