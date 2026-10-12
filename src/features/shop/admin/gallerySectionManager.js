import { escapeHtml } from '../dom.js';
import { slugify } from './slug.js';

/**
 * Self-contained Gallery Sections admin widget — same list/reorder/
 * rename-slug/delete pattern as admin/categoryManager.js, plus a
 * visibility toggle and a "cover needs attention" warning when a
 * section's chosen cover image no longer exists/is visible/still
 * belongs to that section (the public page falls back to the first
 * visible image in that case — see api/gallery.js's getGallerySections).
 *
 * `items` is a read-only snapshot (for image counts + cover-validity),
 * not live-synced with the image grid — reflects what Admin → Gallery
 * loaded at the time this section manager was mounted.
 *
 * @param {any[]} initialSections
 * @param {any[]} items
 * @param {{
 *   onCreate: (fields: {name:string, slug:string}) => Promise<any>,
 *   onRename: (id: string, fields: {name:string, slug:string}) => Promise<any>,
 *   onToggleVisible: (id: string, visible: boolean) => Promise<any>,
 *   onReorder: (orderedIds: string[]) => Promise<void>,
 *   onDelete: (id: string) => Promise<void>,
 * }} handlers
 */
export function createGallerySectionManager(initialSections, items, { onCreate, onRename, onToggleVisible, onReorder, onDelete }) {
  let sections = initialSections.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  let editingId = null;

  const wrap = document.createElement('div');

  function itemCount(sectionId) {
    return items.filter((i) => i.gallerySectionId === sectionId).length;
  }

  /** @returns {string|null} a warning message, or null if the cover (if any) is fine */
  function coverWarning(section) {
    if (!section.featuredGalleryItemId) return null;
    const cover = items.find((i) => i.id === section.featuredGalleryItemId);
    if (!cover || !cover.visible || cover.gallerySectionId !== section.id) {
      return 'Cover needs attention — falling back to the first visible image.';
    }
    return null;
  }

  function render() {
    wrap.innerHTML = `
      <p class="admin-form-error" id="gallery-section-error" hidden></p>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr><th></th><th>Name</th><th>Slug</th><th>Images</th><th>Status</th><th>Cover</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${sections.length === 0 ? '<tr><td colspan="7" class="admin-empty">No gallery sections yet.</td></tr>' : sections.map((s, i) => renderRow(s, i)).join('')}
          </tbody>
        </table>
      </div>
      <div class="admin-form-section">
        <h2 class="admin-form-section-title">Add Gallery Section</h2>
        <form class="admin-form" id="add-gallery-section-form">
          <label>Name <input type="text" name="name" required></label>
          <label>Slug <input type="text" name="slug" required></label>
          <div class="admin-form-actions">
            <button type="submit" class="admin-btn admin-btn-primary">Add Section</button>
          </div>
        </form>
      </div>
    `;
    wire();
  }

  function renderRow(s, index) {
    if (editingId === s.id) {
      return `
        <tr data-id="${s.id}">
          <td></td>
          <td><input type="text" class="admin-edit-name" value="${escapeHtml(s.name)}"></td>
          <td><input type="text" class="admin-edit-slug" value="${escapeHtml(s.slug)}"></td>
          <td>${itemCount(s.id)}</td>
          <td colspan="2"></td>
          <td class="admin-actions-cell">
            <button type="button" class="admin-btn-sm" data-act="save-rename">Save</button>
            <button type="button" class="admin-btn-sm" data-act="cancel-rename">Cancel</button>
          </td>
        </tr>
      `;
    }
    const warning = coverWarning(s);
    return `
      <tr data-id="${s.id}">
        <td class="admin-actions-cell">
          <button type="button" class="admin-btn-sm" data-act="move-up" ${index === 0 ? 'disabled' : ''}>&uarr;</button>
          <button type="button" class="admin-btn-sm" data-act="move-down" ${index === sections.length - 1 ? 'disabled' : ''}>&darr;</button>
        </td>
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.slug)}</td>
        <td>${itemCount(s.id)}</td>
        <td><span class="admin-status admin-status-${s.visible ? 'available' : 'hidden'}">${s.visible ? 'Visible' : 'Hidden'}</span></td>
        <td>${warning ? `<span class="admin-gallery-warnings">! ${escapeHtml(warning)}</span>` : (s.featuredGalleryItemId ? 'Set' : '—')}</td>
        <td class="admin-actions-cell">
          <button type="button" class="admin-btn-sm" data-act="rename">Rename</button>
          <button type="button" class="admin-btn-sm" data-act="toggle-visible">${s.visible ? 'Hide' : 'Show'}</button>
          <button type="button" class="admin-btn-sm admin-btn-danger" data-act="delete">Delete</button>
        </td>
      </tr>
    `;
  }

  function showError(message) {
    const el = /** @type {HTMLElement} */ (wrap.querySelector('#gallery-section-error'));
    el.textContent = message;
    el.hidden = false;
  }

  async function move(id, direction) {
    const index = sections.findIndex((s) => s.id === id);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= sections.length) return;
    const reordered = sections.slice();
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
    try {
      await onReorder(reordered.map((s) => s.id));
      sections = reordered.map((s, i) => ({ ...s, sortOrder: i }));
      render();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not reorder sections.');
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
          sections = sections.map((s) => (s.id === id ? { ...s, name: updated.name, slug: updated.slug } : s));
          editingId = null;
          render();
        } catch (err) {
          showError(err instanceof Error ? err.message : 'Could not rename that section.');
        }
      })
    );
    wrap.querySelectorAll('[data-act="toggle-visible"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = btn.closest('tr').dataset.id;
        const section = sections.find((s) => s.id === id);
        try {
          const updated = await onToggleVisible(id, !section.visible);
          sections = sections.map((s) => (s.id === id ? updated : s));
          render();
        } catch (err) {
          showError(err instanceof Error ? err.message : 'Could not update that section.');
        }
      })
    );
    wrap.querySelectorAll('[data-act="delete"]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = btn.closest('tr').dataset.id;
        const section = sections.find((s) => s.id === id);
        if (!window.confirm(`Delete "${section?.name}"?`)) return;
        try {
          await onDelete(id);
          sections = sections.filter((s) => s.id !== id);
          render();
        } catch (err) {
          showError(err instanceof Error ? err.message : 'Could not delete that section.');
        }
      })
    );

    const addForm = /** @type {HTMLFormElement} */ (wrap.querySelector('#add-gallery-section-form'));
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
        sections = [...sections, created];
        render();
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Could not create that section.');
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
