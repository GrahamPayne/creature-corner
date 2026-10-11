import { escapeHtml } from '../dom.js';
import { validateImageFile } from './imageProcessing.js';
import { getGalleryItemWarnings } from './galleryReadiness.js';

/**
 * Self-contained Gallery admin widget — thumbnail grid with inline
 * Title/Caption/Alt Text editing, Visible/Hidden + Featured toggles,
 * Move Up/Down reordering, delete, and a multi-file uploader. Same
 * own-state/own-re-render pattern as admin/categoryManager.js.
 * @param {any[]} initialItems
 * @param {{
 *   onUpload: (file: File, sortOrder: number) => Promise<any>,
 *   onUpdate: (id: string, patch: object) => Promise<any>,
 *   onReorder: (orderedIds: string[]) => Promise<void>,
 *   onDelete: (item: any) => Promise<void>,
 * }} handlers
 */
export function createGalleryManager(initialItems, { onUpload, onUpdate, onReorder, onDelete }) {
  let items = initialItems.slice().sort((a, b) => a.sortOrder - b.sortOrder);

  const wrap = document.createElement('div');

  function render() {
    wrap.innerHTML = `
      <p class="admin-form-error" id="gallery-error" hidden></p>
      <p class="admin-form-status" id="gallery-status" hidden></p>

      <div class="admin-form-section">
        <h2 class="admin-form-section-title">Add Images</h2>
        <p class="admin-notice">JPG, PNG, or WebP, up to 10MB each. Resized for web use; original quality and aspect ratio are preserved.</p>
        <label class="admin-btn admin-image-add-btn" for="gallery-file-input">+ Add Images</label>
        <input type="file" id="gallery-file-input" class="admin-image-file-input" accept="image/jpeg,image/png,image/webp" multiple>
      </div>

      ${items.length === 0
        ? '<p class="admin-empty">No gallery images yet. Add some above.</p>'
        : `<div class="admin-gallery-grid">${items.map((item, index) => renderCard(item, index)).join('')}</div>`
      }
    `;
    wire();
  }

  function renderCard(item, index) {
    const warnings = getGalleryItemWarnings(item);
    return `
      <div class="admin-gallery-card" data-id="${item.id}">
        <div class="admin-image-thumb-wrap">
          ${item.url
            ? `<img src="${escapeHtml(item.url)}" alt="" class="admin-image-thumb">`
            : '<span class="admin-thumb-placeholder">No image</span>'}
          ${item.featured ? '<span class="admin-image-primary-badge">Featured</span>' : ''}
        </div>
        <span class="admin-status admin-status-${item.visible ? 'available' : 'hidden'}">${item.visible ? 'Visible' : 'Hidden'}</span>
        ${warnings.length ? `<p class="admin-gallery-warnings">${warnings.map((w) => `! ${escapeHtml(w)}`).join('<br>')}</p>` : ''}

        <label>Title
          <input type="text" class="admin-gallery-title" value="${escapeHtml(item.title || '')}">
        </label>
        <label>Caption
          <input type="text" class="admin-gallery-caption" value="${escapeHtml(item.caption || '')}">
        </label>
        <label>Alt text
          <input type="text" class="admin-gallery-alt" value="${escapeHtml(item.altText || '')}">
        </label>

        <div class="admin-image-card-actions">
          <button type="button" class="admin-btn-sm" data-act="save">Save</button>
          <button type="button" class="admin-btn-sm" data-act="toggle-visible">${item.visible ? 'Hide' : 'Show'}</button>
          <button type="button" class="admin-btn-sm" data-act="toggle-featured">${item.featured ? 'Unfeature' : 'Feature'}</button>
          <button type="button" class="admin-btn-sm" data-act="up" ${index === 0 ? 'disabled' : ''}>Move Up</button>
          <button type="button" class="admin-btn-sm" data-act="down" ${index === items.length - 1 ? 'disabled' : ''}>Move Down</button>
          <button type="button" class="admin-btn-sm admin-btn-danger" data-act="delete">Delete</button>
        </div>
      </div>
    `;
  }

  function showError(message) {
    const el = /** @type {HTMLElement} */ (wrap.querySelector('#gallery-error'));
    el.textContent = message;
    el.hidden = false;
  }

  function showStatus(message) {
    const el = /** @type {HTMLElement} */ (wrap.querySelector('#gallery-status'));
    el.textContent = message;
    el.hidden = !message;
  }

  async function move(id, direction) {
    const index = items.findIndex((i) => i.id === id);
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const reordered = items.slice();
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try {
      await onReorder(reordered.map((i) => i.id));
      items = reordered.map((i, idx) => ({ ...i, sortOrder: idx }));
      render();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not reorder images.');
    }
  }

  function wire() {
    const fileInput = /** @type {HTMLInputElement} */ (wrap.querySelector('#gallery-file-input'));
    fileInput.addEventListener('change', async () => {
      if (!fileInput.files || fileInput.files.length === 0) return;
      const files = Array.from(fileInput.files);
      fileInput.value = '';
      wrap.querySelector('#gallery-error').toggleAttribute('hidden', true);

      let nextSortOrder = items.length;
      const failures = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const result = validateImageFile(file);
        if (!result.ok) {
          failures.push(result.error);
          continue;
        }
        showStatus(`Uploading image ${i + 1} of ${files.length}…`);
        try {
          const created = await onUpload(file, nextSortOrder);
          items = [...items, created];
          nextSortOrder += 1;
        } catch (err) {
          console.error('Gallery upload failed', err);
          failures.push(err instanceof Error ? err.message : `Could not upload "${file.name}".`);
        }
      }
      showStatus('');
      if (failures.length > 0) showError(failures.join(' '));
      render();
    });

    wrap.querySelectorAll('.admin-gallery-card').forEach((card) => {
      const id = card.getAttribute('data-id');
      const item = items.find((i) => i.id === id);

      card.querySelector('[data-act="save"]').addEventListener('click', async () => {
        const title = /** @type {HTMLInputElement} */ (card.querySelector('.admin-gallery-title')).value.trim();
        const caption = /** @type {HTMLInputElement} */ (card.querySelector('.admin-gallery-caption')).value.trim();
        const altText = /** @type {HTMLInputElement} */ (card.querySelector('.admin-gallery-alt')).value.trim();
        try {
          const updated = await onUpdate(id, { title: title || null, caption: caption || null, altText: altText || null });
          items = items.map((i) => (i.id === id ? updated : i));
          showStatus('Saved.');
          render();
        } catch (err) {
          showError(err instanceof Error ? err.message : 'Could not save that image.');
        }
      });

      card.querySelector('[data-act="toggle-visible"]').addEventListener('click', async () => {
        try {
          const updated = await onUpdate(id, { visible: !item.visible });
          items = items.map((i) => (i.id === id ? updated : i));
          render();
        } catch (err) {
          showError(err instanceof Error ? err.message : 'Could not update visibility.');
        }
      });

      card.querySelector('[data-act="toggle-featured"]').addEventListener('click', async () => {
        try {
          const updated = await onUpdate(id, { featured: !item.featured });
          items = items.map((i) => (i.id === id ? updated : i));
          render();
        } catch (err) {
          showError(err instanceof Error ? err.message : 'Could not update featured.');
        }
      });

      card.querySelector('[data-act="up"]').addEventListener('click', () => move(id, -1));
      card.querySelector('[data-act="down"]').addEventListener('click', () => move(id, 1));

      card.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        if (!window.confirm('Delete this gallery image? This cannot be undone.')) return;
        try {
          await onDelete(item);
          items = items.filter((i) => i.id !== id);
          render();
        } catch (err) {
          showError(err instanceof Error ? err.message : 'Could not delete that image.');
        }
      });
    });
  }

  render();
  return wrap;
}
