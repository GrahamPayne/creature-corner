import { escapeHtml } from '../dom.js';
import { slugify } from './slug.js';

/**
 * Self-contained Categories admin widget: list (with product counts,
 * reorder, rename/edit-slug, delete) + an "Add Category" form. Mirrors
 * productTable.js/admin.js's pattern of owning its own re-render instead
 * of diffing the DOM.
 * @param {{id:string, slug:string, name:string, sortOrder:number, productCount:number}[]} initialCategories
 * @param {{
 *   onCreate: (fields: {name:string, slug:string}) => Promise<any>,
 *   onRename: (id: string, fields: {name:string, slug:string}) => Promise<any>,
 *   onReorder: (orderedIds: string[]) => Promise<void>,
 *   onDelete: (id: string) => Promise<void>,
 * }} handlers
 */
export function createCategoryManager(initialCategories, { onCreate, onRename, onReorder, onDelete }) {
  let categories = initialCategories.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  let editingId = null;

  const wrap = document.createElement('div');

  function render() {
    wrap.innerHTML = `
      <p class="admin-form-error" id="category-error" hidden></p>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr><th></th><th>Name</th><th>Slug</th><th>Products</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${categories.length === 0 ? '<tr><td colspan="5" class="admin-empty">No categories yet.</td></tr>' : categories.map((c, i) => renderRow(c, i)).join('')}
          </tbody>
        </table>
      </div>
      <div class="admin-form-section">
        <h2 class="admin-form-section-title">Add Category</h2>
        <form class="admin-form" id="add-category-form">
          <label>Name <input type="text" name="name" required></label>
          <label>Slug <input type="text" name="slug" required></label>
          <div class="admin-form-actions">
            <button type="submit" class="admin-btn admin-btn-primary">Add Category</button>
          </div>
        </form>
      </div>
    `;
    wire();
  }

  function renderRow(c, index) {
    if (editingId === c.id) {
      return `
        <tr data-id="${c.id}">
          <td></td>
          <td><input type="text" class="admin-edit-name" value="${escapeHtml(c.name)}"></td>
          <td><input type="text" class="admin-edit-slug" value="${escapeHtml(c.slug)}"></td>
          <td>${c.productCount}</td>
          <td class="admin-actions-cell">
            <button type="button" class="admin-btn-sm" data-act="save-rename">Save</button>
            <button type="button" class="admin-btn-sm" data-act="cancel-rename">Cancel</button>
          </td>
        </tr>
      `;
    }
    return `
      <tr data-id="${c.id}">
        <td class="admin-actions-cell">
          <button type="button" class="admin-btn-sm" data-act="move-up" ${index === 0 ? 'disabled' : ''}>&uarr;</button>
          <button type="button" class="admin-btn-sm" data-act="move-down" ${index === categories.length - 1 ? 'disabled' : ''}>&darr;</button>
        </td>
        <td>${escapeHtml(c.name)}</td>
        <td>${escapeHtml(c.slug)}</td>
        <td>${c.productCount}</td>
        <td class="admin-actions-cell">
          <button type="button" class="admin-btn-sm" data-act="rename">Rename</button>
          <button type="button" class="admin-btn-sm admin-btn-danger" data-act="delete">Delete</button>
        </td>
      </tr>
    `;
  }

  function showError(message) {
    const el = /** @type {HTMLElement} */ (wrap.querySelector('#category-error'));
    el.textContent = message;
    el.hidden = false;
  }

  async function move(id, direction) {
    const index = categories.findIndex((c) => c.id === id);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= categories.length) return;
    const reordered = categories.slice();
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
    try {
      await onReorder(reordered.map((c) => c.id));
      categories = reordered.map((c, i) => ({ ...c, sortOrder: i }));
      render();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not reorder categories.');
    }
  }

  function wire() {
    wrap.querySelectorAll('[data-act="move-up"]').forEach((btn) =>
      btn.addEventListener('click', () => move(btn.closest('tr').dataset.id, -1))
    );
    wrap.querySelectorAll('[data-act="move-down"]').forEach((btn) =>
      btn.addEventListener('click', () => move(btn.closest('tr').dataset.id, 1))
    );
    wrap.querySelectorAll('[data-act="rename"]').forEach((btn) =>
      btn.addEventListener('click', () => {
        editingId = btn.closest('tr').dataset.id;
        render();
      })
    );
    wrap.querySelectorAll('[data-act="cancel-rename"]').forEach((btn) =>
      btn.addEventListener('click', () => {
        editingId = null;
        render();
      })
    );
    wrap.querySelectorAll('[data-act="save-rename"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const id = row.dataset.id;
        const name = /** @type {HTMLInputElement} */ (row.querySelector('.admin-edit-name')).value.trim();
        const slug = slugify(/** @type {HTMLInputElement} */ (row.querySelector('.admin-edit-slug')).value);
        if (!name || !slug) {
          showError('Name and slug cannot be empty.');
          return;
        }
        try {
          const updated = await onRename(id, { name, slug });
          categories = categories.map((c) => (c.id === id ? { ...c, name: updated.name, slug: updated.slug } : c));
          editingId = null;
          render();
        } catch (err) {
          showError(err instanceof Error ? err.message : 'Could not rename that category.');
        }
      })
    );
    wrap.querySelectorAll('[data-act="delete"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = btn.closest('tr').dataset.id;
        const category = categories.find((c) => c.id === id);
        if (!window.confirm(`Delete "${category?.name}"?`)) return;
        try {
          await onDelete(id);
          categories = categories.filter((c) => c.id !== id);
          render();
        } catch (err) {
          showError(err instanceof Error ? err.message : 'Could not delete that category.');
        }
      })
    );

    const addForm = /** @type {HTMLFormElement} */ (wrap.querySelector('#add-category-form'));
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(addForm);
      const name = String(data.get('name') || '').trim();
      const slug = slugify(String(data.get('slug') || ''));
      if (!name || !slug) {
        showError('Name and slug cannot be empty.');
        return;
      }
      try {
        const created = await onCreate({ name, slug });
        categories = [...categories, { ...created, productCount: 0 }];
        render();
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Could not create that category.');
      }
    });

    const slugInput = /** @type {HTMLInputElement} */ (addForm.elements.namedItem('slug'));
    const nameInput = /** @type {HTMLInputElement} */ (addForm.elements.namedItem('name'));
    let slugTouched = false;
    slugInput.addEventListener('input', () => { slugTouched = true; });
    nameInput.addEventListener('input', () => {
      if (!slugTouched) slugInput.value = slugify(nameInput.value);
    });
  }

  render();
  return wrap;
}
