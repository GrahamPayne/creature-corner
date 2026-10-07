import { formatCents } from '../money.js';
import { escapeHtml } from '../dom.js';

/**
 * @param {any[]} products
 * @param {{onEdit:(id:string)=>void, onDuplicate:(id:string)=>void, onDelete:(id:string)=>void, onQuickAction:(id:string, patch:object)=>void}} handlers
 */
export function createProductTable(products, { onEdit, onDuplicate, onDelete, onQuickAction }) {
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
        <th>Featured</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');

  for (const p of products) {
    const primary = p.images.find((i) => i.isPrimary) || p.images[0] || null;
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
    tr.querySelector('[data-act="available"]').addEventListener('click', () => onQuickAction(p.id, { status: 'available' }));
    tr.querySelector('[data-act="toggle-visibility"]').addEventListener('click', () =>
      onQuickAction(p.id, { status: p.status === 'hidden' ? 'available' : 'hidden' })
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
