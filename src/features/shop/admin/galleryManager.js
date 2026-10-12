import { escapeHtml } from '../dom.js';
import { validateImageFile } from './imageProcessing.js';
import { getGalleryItemWarnings } from './galleryReadiness.js';
import {
  effectiveFields,
  isDirty,
  buildPatch,
  mergeSavedItem,
  setDraft,
  clearDraft,
  dirtyIds,
  hasAnyDirty,
  sectionSiblings,
  moveWithinSection,
} from './galleryDraftState.js';

/**
 * Self-contained Gallery admin widget — thumbnail grid with inline
 * Title/Caption/Alt Text/Section editing, Visible/Featured checkboxes,
 * Move Up/Down (scoped to the item's own section), delete, Set as
 * Section Cover, and a multi-file uploader.
 *
 * Every field is draft-tracked (src/features/shop/admin/galleryDraftState.js)
 * so no action here ever discards unsaved edits on a different card — see
 * that module's header comment for why (this replaces a shipped bug).
 * Save/Delete/Move/Upload/Set-Cover all do a *targeted* DOM update
 * (just the affected card/cards) rather than a full rebuild; only a
 * filter change or Save All re-renders the whole grid, and that's safe
 * now because drafts live outside the render cycle.
 *
 * @param {any[]} initialItems
 * @param {any[]} initialSections
 * @param {{
 *   onUpload: (file: File, sortOrder: number, gallerySectionId: string|null) => Promise<any>,
 *   onUpdate: (id: string, patch: object) => Promise<any>,
 *   onReorder: (orderedIds: string[]) => Promise<void>,
 *   onDelete: (item: any) => Promise<void>,
 *   onSetCover: (sectionId: string, itemId: string|null) => Promise<any>,
 * }} handlers
 * @returns {{element: HTMLElement, hasUnsavedChanges: () => boolean, destroy: () => void}}
 */
export function createGalleryManager(initialItems, initialSections, { onUpload, onUpdate, onReorder, onDelete, onSetCover }) {
  let items = initialItems.slice();
  let sections = initialSections.slice();
  /** @type {Map<string, any>} */
  let drafts = new Map();
  let activeFilter = 'all';

  const wrap = document.createElement('div');

  const beforeUnloadHandler = (e) => {
    if (!hasAnyDirty(items, drafts)) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);

  function sectionOptionsHtml(selectedId) {
    const opts = [`<option value="" ${!selectedId ? 'selected' : ''}>Unassigned</option>`];
    for (const s of sections) {
      opts.push(`<option value="${s.id}" ${selectedId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`);
    }
    return opts.join('');
  }

  function visibleItems() {
    let filtered;
    if (activeFilter === 'all') filtered = items;
    else if (activeFilter === 'unassigned') filtered = items.filter((i) => !i.gallerySectionId);
    else filtered = items.filter((i) => i.gallerySectionId === activeFilter);
    // sort_order is scoped per section (including the null/"Unassigned"
    // group) — sorting the filtered-to-one-group view by it is always
    // meaningful; the mixed "All" view sorts the same way per sub-group
    // for a stable, non-arbitrary ordering (ties across groups by id).
    return filtered.slice().sort((a, b) => a.sortOrder - b.sortOrder || String(a.gallerySectionId).localeCompare(String(b.gallerySectionId)));
  }

  function render() {
    const shown = visibleItems();
    wrap.innerHTML = `
      <p class="admin-form-error" id="gallery-error" hidden></p>
      <p class="admin-form-status" id="gallery-status" hidden></p>

      <div class="admin-form-section">
        <h2 class="admin-form-section-title">Add Images</h2>
        <p class="admin-notice">JPG, PNG, or WebP, up to 10MB each. Resized for web use; original quality and aspect ratio are preserved. New images are added to the currently filtered section (or Unassigned, under "All").</p>
        <label class="admin-btn admin-image-add-btn" for="gallery-file-input">+ Add Images</label>
        <input type="file" id="gallery-file-input" class="admin-image-file-input" accept="image/jpeg,image/png,image/webp" multiple>
      </div>

      <div class="admin-header">
        <div class="admin-filter-bar" id="gallery-filter-bar">
          <button type="button" class="admin-btn-sm${activeFilter === 'all' ? ' admin-btn-sm-active' : ''}" data-filter="all">All</button>
          <button type="button" class="admin-btn-sm${activeFilter === 'unassigned' ? ' admin-btn-sm-active' : ''}" data-filter="unassigned">Unassigned</button>
          ${sections.map((s) => `<button type="button" class="admin-btn-sm${activeFilter === s.id ? ' admin-btn-sm-active' : ''}" data-filter="${s.id}">${escapeHtml(s.name)}</button>`).join('')}
        </div>
        <button type="button" class="admin-btn admin-btn-primary" id="gallery-save-all">Save All Changes</button>
      </div>

      ${shown.length === 0
        ? '<p class="admin-empty">No gallery images in this view yet.</p>'
        : `<div class="admin-gallery-grid" id="gallery-grid-mount">${shown.map((item) => buildCardHtml(item)).join('')}</div>`
      }
    `;
    wireStatic();
    shown.forEach((item) => wireCard(item.id));
  }

  function buildCardHtml(item) {
    const draft = drafts.get(item.id);
    const eff = effectiveFields(item, draft);
    const dirty = isDirty(item, draft);
    const siblings = sectionSiblings(items, item.gallerySectionId);
    const idx = siblings.findIndex((i) => i.id === item.id);
    const isFirst = idx <= 0;
    const isLast = idx === -1 || idx === siblings.length - 1;
    const warnings = getGalleryItemWarnings({ storagePath: item.storagePath, altText: eff.altText });
    const coveringSection = sections.find((s) => s.featuredGalleryItemId === item.id);
    const canSetCover = Boolean(item.gallerySectionId) && (!coveringSection || coveringSection.id !== item.gallerySectionId);

    return `
      <div class="admin-gallery-card" data-id="${item.id}">
        <div class="admin-image-thumb-wrap">
          ${item.url
            ? `<img src="${escapeHtml(item.url)}" alt="" class="admin-image-thumb">`
            : '<span class="admin-thumb-placeholder">No image</span>'}
          ${coveringSection ? `<span class="admin-image-primary-badge">Cover: ${escapeHtml(coveringSection.name)}</span>` : ''}
        </div>
        <div class="admin-gallery-badges">
          <span class="admin-status admin-status-${eff.visible ? 'available' : 'hidden'}">${eff.visible ? 'Visible' : 'Hidden'}</span>
          ${dirty ? '<span class="admin-gallery-unsaved">UNSAVED</span>' : ''}
        </div>
        ${warnings.length ? `<p class="admin-gallery-warnings">${warnings.map((w) => `! ${escapeHtml(w)}`).join('<br>')}</p>` : ''}

        <label>Title
          <input type="text" class="admin-gallery-title" value="${escapeHtml(eff.title)}">
        </label>
        <label>Caption
          <input type="text" class="admin-gallery-caption" value="${escapeHtml(eff.caption)}">
        </label>
        <label>Alt text
          <input type="text" class="admin-gallery-alt" value="${escapeHtml(eff.altText)}">
        </label>
        <label>Section
          <select class="admin-gallery-section">${sectionOptionsHtml(eff.gallerySectionId)}</select>
        </label>
        <label class="admin-form-checkbox">
          <input type="checkbox" class="admin-gallery-visible" ${eff.visible ? 'checked' : ''}>
          Visible
        </label>
        <label class="admin-form-checkbox">
          <input type="checkbox" class="admin-gallery-featured" ${eff.featured ? 'checked' : ''}>
          Featured
        </label>

        <div class="admin-image-card-actions">
          <button type="button" class="admin-btn-sm" data-act="save">Save</button>
          ${canSetCover ? '<button type="button" class="admin-btn-sm" data-act="set-cover">Set as Section Cover</button>' : ''}
          <button type="button" class="admin-btn-sm" data-act="up" ${isFirst ? 'disabled' : ''}>Move Up</button>
          <button type="button" class="admin-btn-sm" data-act="down" ${isLast ? 'disabled' : ''}>Move Down</button>
          <button type="button" class="admin-btn-sm admin-btn-danger" data-act="delete">Delete</button>
        </div>
      </div>
    `;
  }

  function cardEl(id) {
    return wrap.querySelector(`.admin-gallery-card[data-id="${id}"]`);
  }

  /** Re-renders just one card in place and re-wires it — the targeted update that replaces the old full-grid render() on most actions. */
  function refreshCard(id) {
    const item = items.find((i) => i.id === id);
    const el = cardEl(id);
    if (!item || !el) return;
    const template = document.createElement('template');
    template.innerHTML = buildCardHtml(item).trim();
    const next = template.content.firstElementChild;
    el.replaceWith(next);
    wireCard(id);
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

  function readDraftFromCard(el) {
    return {
      title: /** @type {HTMLInputElement} */ (el.querySelector('.admin-gallery-title')).value,
      caption: /** @type {HTMLInputElement} */ (el.querySelector('.admin-gallery-caption')).value,
      altText: /** @type {HTMLInputElement} */ (el.querySelector('.admin-gallery-alt')).value,
      gallerySectionId: /** @type {HTMLSelectElement} */ (el.querySelector('.admin-gallery-section')).value || null,
      visible: /** @type {HTMLInputElement} */ (el.querySelector('.admin-gallery-visible')).checked,
      featured: /** @type {HTMLInputElement} */ (el.querySelector('.admin-gallery-featured')).checked,
    };
  }

  /** Saves one card's current draft. Returns true on success. Used by both the per-card Save button and Save All. */
  async function saveCard(id) {
    const draft = drafts.get(id);
    if (!draft) return true;
    const patch = buildPatch(draft);
    const movedToSection = items.find((i) => i.id === id)?.gallerySectionId !== draft.gallerySectionId;
    if (movedToSection) {
      // Append at the end of the new section's own order rather than colliding with its existing sort_order values.
      const newSiblingCount = sectionSiblings(items, draft.gallerySectionId).length;
      patch.sortOrder = newSiblingCount;
    }
    const updated = await onUpdate(id, patch);
    ({ items, drafts } = mergeSavedItem({ items, drafts }, updated));
    return true;
  }

  function wireStatic() {
    const fileInput = /** @type {HTMLInputElement} */ (wrap.querySelector('#gallery-file-input'));
    fileInput.addEventListener('change', async () => {
      if (!fileInput.files || fileInput.files.length === 0) return;
      const files = Array.from(fileInput.files);
      fileInput.value = '';
      wrap.querySelector('#gallery-error').toggleAttribute('hidden', true);

      const targetSectionId = activeFilter !== 'all' && activeFilter !== 'unassigned' ? activeFilter : null;
      let nextSortOrder = sectionSiblings(items, targetSectionId).length;
      const failures = [];
      const grid = wrap.querySelector('#gallery-grid-mount');
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const result = validateImageFile(file);
        if (!result.ok) {
          failures.push(result.error);
          continue;
        }
        showStatus(`Uploading image ${i + 1} of ${files.length}…`);
        try {
          const created = await onUpload(file, nextSortOrder, targetSectionId);
          items = [...items, created];
          nextSortOrder += 1;
          if (grid) {
            grid.insertAdjacentHTML('beforeend', buildCardHtml(created));
            wireCard(created.id);
          } else {
            render();
          }
        } catch (err) {
          console.error('Gallery upload failed', err);
          failures.push(err instanceof Error ? err.message : `Could not upload "${file.name}".`);
        }
      }
      showStatus('');
      if (failures.length > 0) showError(failures.join(' '));
      // No grid existed before this upload (previous state was empty) — now it does, needs a full render once.
      if (!grid) render();
    });

    wrap.querySelectorAll('[data-filter]').forEach((btn) =>
      btn.addEventListener('click', () => {
        activeFilter = btn.getAttribute('data-filter');
        render();
      })
    );

    wrap.querySelector('#gallery-save-all').addEventListener('click', async () => {
      const ids = dirtyIds(items, drafts);
      if (ids.length === 0) {
        showStatus('Nothing to save.');
        return;
      }
      wrap.querySelector('#gallery-error').toggleAttribute('hidden', true);
      const failedTitles = [];
      for (const id of ids) {
        const beforeItem = items.find((i) => i.id === id);
        try {
          await saveCard(id);
          refreshCard(id);
        } catch (err) {
          console.error('Save All: one image failed', err);
          failedTitles.push(beforeItem?.title || beforeItem?.id || id);
        }
      }
      if (failedTitles.length > 0) {
        showError(`Saved ${ids.length - failedTitles.length} of ${ids.length}. Could not save: ${failedTitles.join(', ')}. Their changes were kept — try again.`);
      } else {
        showStatus(`Saved ${ids.length} image${ids.length === 1 ? '' : 's'}.`);
      }
    });
  }

  function wireCard(id) {
    const el = cardEl(id);
    if (!el) return;
    const item = items.find((i) => i.id === id);

    function syncDraft() {
      drafts = setDraft(drafts, id, readDraftFromCard(el));
      // Only the UNSAVED badge/status-pill text needs to react live; a
      // full card rebuild here would steal focus mid-typing.
      const badges = el.querySelector('.admin-gallery-badges');
      const draft = drafts.get(id);
      const dirty = isDirty(item, draft);
      const statusPill = badges.querySelector('.admin-status');
      statusPill.className = `admin-status admin-status-${draft.visible ? 'available' : 'hidden'}`;
      statusPill.textContent = draft.visible ? 'Visible' : 'Hidden';
      let unsavedEl = badges.querySelector('.admin-gallery-unsaved');
      if (dirty && !unsavedEl) {
        unsavedEl = document.createElement('span');
        unsavedEl.className = 'admin-gallery-unsaved';
        unsavedEl.textContent = 'UNSAVED';
        badges.appendChild(unsavedEl);
      } else if (!dirty && unsavedEl) {
        unsavedEl.remove();
      }
    }

    el.querySelectorAll('input[type="text"], select, input[type="checkbox"]').forEach((input) => {
      input.addEventListener('input', syncDraft);
      input.addEventListener('change', syncDraft);
    });

    el.querySelector('[data-act="save"]').addEventListener('click', async () => {
      try {
        await saveCard(id);
        showStatus('Saved.');
        refreshCard(id);
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Could not save that image.');
      }
    });

    const coverBtn = el.querySelector('[data-act="set-cover"]');
    if (coverBtn) {
      coverBtn.addEventListener('click', async () => {
        const sectionId = item.gallerySectionId;
        const oldCoverId = sections.find((s) => s.id === sectionId)?.featuredGalleryItemId;
        try {
          const updatedSection = await onSetCover(sectionId, id);
          sections = sections.map((s) => (s.id === sectionId ? updatedSection : s));
          showStatus('Section cover updated.');
          refreshCard(id);
          if (oldCoverId && oldCoverId !== id) refreshCard(oldCoverId);
        } catch (err) {
          showError(err instanceof Error ? err.message : 'Could not set that as the section cover.');
        }
      });
    }

    el.querySelector('[data-act="up"]').addEventListener('click', () => move(id, -1));
    el.querySelector('[data-act="down"]').addEventListener('click', () => move(id, 1));

    el.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      if (!window.confirm('Delete this gallery image? This cannot be undone.')) return;
      try {
        await onDelete(item);
        items = items.filter((i) => i.id !== id);
        drafts = clearDraft(drafts, id);
        el.remove();
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Could not delete that image.');
      }
    });
  }

  /** Standard two-node DOM swap — correct whether a/b are adjacent or not, and leaves every other node's position untouched. */
  function swapNodes(a, b) {
    const aParent = a.parentNode;
    const bParent = b.parentNode;
    if (!aParent || !bParent) return;
    const aNext = a.nextSibling;
    const bNext = b.nextSibling;
    bParent.insertBefore(a, bNext);
    aParent.insertBefore(b, aNext);
  }

  async function move(id, direction) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const before = sectionSiblings(items, item.gallerySectionId).map((i) => i.id);
    const after = moveWithinSection(items, id, direction);
    if (!after) return;
    const changedIds = before.filter((bid, i) => bid !== after[i]);
    try {
      await onReorder(after);
      const orderIndex = new Map(after.map((oid, i) => [oid, i]));
      items = items.map((i) => (orderIndex.has(i.id) ? { ...i, sortOrder: orderIndex.get(i.id) } : i));

      // Exactly two ids change position for a single up/down move — swap
      // their actual DOM nodes (same filtered view always contains both,
      // since they share a gallerySectionId) before refreshing each in
      // place, so the visible order actually changes, not just their data.
      if (changedIds.length === 2) {
        const [elA, elB] = changedIds.map((cid) => cardEl(cid));
        if (elA && elB) swapNodes(elA, elB);
      }
      changedIds.forEach((cid) => refreshCard(cid));
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not reorder images.');
    }
  }

  render();

  return {
    element: wrap,
    hasUnsavedChanges: () => hasAnyDirty(items, drafts),
    destroy: () => window.removeEventListener('beforeunload', beforeUnloadHandler),
  };
}
