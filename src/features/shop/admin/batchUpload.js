import { slugify } from './slug.js';
import { escapeHtml } from '../dom.js';
import { formatCents } from '../money.js';
import { validateImageFile } from './imageProcessing.js';
import { isDuplicateSlugError } from './apiErrors.js';
import { computeReadinessChecks, getReadinessStatus, getBlockingIssues } from './readiness.js';
import {
  FULFILLMENT_MODES,
  PACKAGE_SIZES,
  fulfillmentNeedsPackageSize,
  fulfillmentRequiresPackedData,
  resolveFulfillment,
  validatePackedShipping,
} from './fulfillment.js';
import { nextSequenceStart, formatSequenceNumber } from './batchNaming.js';
import { createBatchRunner } from './batchCreate.js';

const PUBLISH_MODE_KEY = 'creature-corner-admin-batch-publish-mode';
const STATUS_OPTIONS = [
  ['draft', 'Draft'],
  ['available', 'Available'],
];

function rememberedPublishMode() {
  const stored = localStorage.getItem(PUBLISH_MODE_KEY);
  return stored === 'publish' ? 'publish' : 'draft';
}

function uid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultShared() {
  return {
    nameBase: '',
    shortDescription: '',
    description: '',
    priceCents: 0,
    categoryId: '',
    materials: '',
    dimensions: '',
    quantity: 1,
    featured: false,
    fulfillmentMode: 'ship_only',
    packageSize: 'medium',
    packedWeightLb: 0,
    packedWeightOz: 0,
    packageLengthIn: null,
    packageWidthIn: null,
    packageHeightIn: null,
    publishMode: rememberedPublishMode(),
  };
}

/**
 * Batch Upload: a faster way to create many completely independent products
 * at once. Shared fields here are only a data-entry shortcut — the moment
 * "Create N Products" runs, each item becomes its own adminCreateProduct()
 * call producing a normal, independently editable product row, exactly as
 * if Add Product had been submitted once per photo. See CLAUDE.md-adjacent
 * admin/readiness.js and admin/api.js, which this reuses rather than
 * duplicates.
 *
 * @param {{
 *   categories: {id:string, slug:string, name:string}[],
 *   products: any[],
 *   shippingRates: Record<string, number|null>,
 *   onCreateProduct: (fields: any) => Promise<any>,
 *   onUploadImage: (productId: string, file: File, opts: {isPrimary: boolean, sortOrder: number}) => Promise<any>,
 *   onCancel: () => void,
 *   onDone: () => void,
 * }} opts
 */
export function createBatchUpload({ categories, products, shippingRates, onCreateProduct, onUploadImage, onCancel, onDone }) {
  const root = document.createElement('div');
  root.className = 'admin-batch';

  const shared = defaultShared();
  /** @type {{id:string, file:File, previewUrl:string, sequenceNumber:number, autoName:string, nameOverridden:boolean, overrides:Record<string,any>, createdProduct:any, imageUploaded:boolean, uiStatus:string, uiError:string|null}[]} */
  let items = [];
  const expandedIds = new Set();
  let draggedId = null;
  let phase = 'editing'; // 'editing' | 'progress'
  let runner = null;

  // ---- naming ----

  function renumber() {
    const base = shared.nameBase.trim();
    const start = base ? nextSequenceStart(products.map((p) => p.name), base) : 1;
    items.forEach((item, i) => {
      item.sequenceNumber = start + i;
      if (!item.nameOverridden) item.autoName = base ? `${base}-${formatSequenceNumber(start + i)}` : '';
    });
  }

  // ---- field resolution ----

  function effectiveValue(item, key) {
    return Object.prototype.hasOwnProperty.call(item.overrides, key) ? item.overrides[key] : shared[key];
  }

  function effectiveName(item) {
    return item.nameOverridden ? item.overrides.name : item.autoName;
  }

  function effectiveStatus(item) {
    if (Object.prototype.hasOwnProperty.call(item.overrides, 'status')) return item.overrides.status;
    return shared.publishMode === 'publish' ? 'available' : 'draft';
  }

  /** Builds a product-shaped object — the same shape adminCreateProduct()/readiness.js expect — from an item's effective (shared + overrides) fields. */
  function buildProductShape(item) {
    const mode = effectiveValue(item, 'fulfillmentMode');
    const packageSize = effectiveValue(item, 'packageSize');
    const { shippingClass, pickupAvailable } = resolveFulfillment(mode, packageSize);
    return {
      name: effectiveName(item),
      priceCents: Number(effectiveValue(item, 'priceCents')) || 0,
      categoryId: effectiveValue(item, 'categoryId') || null,
      shortDescription: effectiveValue(item, 'shortDescription') || '',
      description: effectiveValue(item, 'description') || '',
      dimensions: effectiveValue(item, 'dimensions') || '',
      materials: effectiveValue(item, 'materials') || '',
      quantity: Number(effectiveValue(item, 'quantity')) || 0,
      shippingClass,
      pickupAvailable,
      packedWeightLb: Number(effectiveValue(item, 'packedWeightLb')) || 0,
      packedWeightOz: Number(effectiveValue(item, 'packedWeightOz')) || 0,
      packageLengthIn: effectiveValue(item, 'packageLengthIn'),
      packageWidthIn: effectiveValue(item, 'packageWidthIn'),
      packageHeightIn: effectiveValue(item, 'packageHeightIn'),
      featured: Boolean(effectiveValue(item, 'featured')),
      status: effectiveStatus(item),
      imageCount: 1,
    };
  }

  function cardReadiness(item) {
    const shape = buildProductShape(item);
    const checks = computeReadinessChecks(shape, { shippingRates });
    return { readiness: getReadinessStatus(shape, checks), blocking: getBlockingIssues(checks) };
  }

  // ---- image selection ----

  function addFiles(fileList) {
    const files = Array.from(fileList);
    const errors = [];
    for (const file of files) {
      const result = validateImageFile(file);
      if (!result.ok) {
        errors.push(result.error);
        continue;
      }
      items.push({
        id: uid(),
        file,
        previewUrl: URL.createObjectURL(file),
        sequenceNumber: 0,
        autoName: '',
        nameOverridden: false,
        overrides: {},
        createdProduct: null,
        imageUploaded: false,
        uiStatus: 'idle',
        uiError: null,
      });
    }
    renumber();
    renderCards();
    showEditingNotice(errors.join(' '));
  }

  function removeItem(id) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    URL.revokeObjectURL(item.previewUrl);
    items = items.filter((i) => i.id !== id);
    expandedIds.delete(id);
    renumber();
    renderCards();
  }

  function moveItem(id, direction) {
    const index = items.findIndex((i) => i.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    renumber();
    renderCards();
  }

  function clearBatch() {
    if (items.length > 0 && !window.confirm(`Clear all ${items.length} selected image${items.length === 1 ? '' : 's'}?`)) return;
    items.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    items = [];
    expandedIds.clear();
    renderCards();
  }

  // ---- copy from existing product ----

  function applyTemplate(productId) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    Object.assign(shared, {
      shortDescription: p.shortDescription || '',
      description: p.description || '',
      priceCents: p.priceCents || 0,
      categoryId: p.category?.id || '',
      materials: p.materials || '',
      dimensions: p.dimensions || '',
      featured: Boolean(p.featured),
      fulfillmentMode: p.shippingClass === 'special_quote' ? 'special_quote' : p.shippingClass === 'pickup_only' ? 'pickup_only' : p.pickupAvailable ? 'ship_and_pickup' : 'ship_only',
      packageSize: PACKAGE_SIZES.some(([key]) => key === p.shippingClass) ? p.shippingClass : 'medium',
      packedWeightLb: p.packedWeightLb || 0,
      packedWeightOz: p.packedWeightOz || 0,
      packageLengthIn: p.packageLengthIn ?? null,
      packageWidthIn: p.packageWidthIn ?? null,
      packageHeightIn: p.packageHeightIn ?? null,
    });
    renderEditing();
  }

  // ---- rendering: shell ----

  function render() {
    if (phase === 'progress') renderProgress();
    else renderEditing();
  }

  function showEditingNotice(text) {
    const el = /** @type {HTMLElement} */ (root.querySelector('#batch-notice'));
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  function renderEditing() {
    const categoryOptions = categories.map((c) => `<option value="${c.id}" ${shared.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    const fulfillmentOptions = FULFILLMENT_MODES.map(([key, label]) => `<option value="${key}" ${shared.fulfillmentMode === key ? 'selected' : ''}>${label}</option>`).join('');
    const packageSizeOptions = PACKAGE_SIZES.map(([key, label]) => `<option value="${key}" ${shared.packageSize === key ? 'selected' : ''}>${label}</option>`).join('');
    const templateOptions = products
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
      .join('');

    root.innerHTML = `
      <div class="admin-header">
        <h1>Batch Upload</h1>
        <div class="admin-header-actions">
          <button type="button" class="admin-btn" data-action="cancel">Cancel</button>
        </div>
      </div>

      <p class="admin-form-error" id="batch-notice" hidden></p>
      <p class="admin-form-error" id="batch-validation-error" hidden></p>

      <div class="admin-form-section">
        <h2 class="admin-form-section-title">Images</h2>
        <div class="admin-batch-dropzone" id="batch-dropzone">
          <p>Drag &amp; drop photos here, or</p>
          <label class="admin-btn admin-image-add-btn" for="batch-file-input">Select Images</label>
          <input type="file" id="batch-file-input" class="admin-image-file-input" accept="image/jpeg,image/png,image/webp" multiple>
        </div>
        <div class="admin-batch-toolbar">
          <span id="batch-count">${items.length} product${items.length === 1 ? '' : 's'}</span>
          <button type="button" class="admin-btn-sm" id="batch-clear-btn" ${items.length === 0 ? 'disabled' : ''}>Clear Batch</button>
        </div>
      </div>

      <div class="admin-form-section">
        <h2 class="admin-form-section-title">Shared Product Information</h2>
        <p class="admin-notice">Applies to every product below, except fields you've overridden on an individual card.</p>

        <label>Copy From Existing Product
          <div class="admin-form-row">
            <select id="batch-template-select">
              <option value="">Select a product&hellip;</option>
              ${templateOptions}
            </select>
            <button type="button" class="admin-btn-sm" id="batch-template-apply" ${products.length === 0 ? 'disabled' : ''}>Apply</button>
          </div>
        </label>

        <label>Shared product name
          <input type="text" id="shared-nameBase" value="${escapeHtml(shared.nameBase)}" placeholder="e.g. Creature Lighter">
        </label>
        <p class="admin-notice" id="batch-naming-preview">${namingPreviewText()}</p>

        <div class="admin-form-row">
          <label>Price (USD)
            <input type="number" id="shared-priceCents" min="0" step="0.01" value="${(shared.priceCents / 100).toFixed(2)}">
          </label>
          <label>Category
            <select id="shared-categoryId">
              <option value="">Select a category&hellip;</option>
              ${categoryOptions}
            </select>
          </label>
          <label>Quantity (each)
            <input type="number" id="shared-quantity" min="0" step="1" value="${shared.quantity}">
          </label>
        </div>

        <label>Short description
          <input type="text" id="shared-shortDescription" value="${escapeHtml(shared.shortDescription)}">
        </label>
        <label>Full description
          <textarea id="shared-description" rows="3">${escapeHtml(shared.description)}</textarea>
        </label>
        <div class="admin-form-row">
          <label>Materials
            <input type="text" id="shared-materials" value="${escapeHtml(shared.materials)}">
          </label>
          <label>Dimensions
            <input type="text" id="shared-dimensions" value="${escapeHtml(shared.dimensions)}">
          </label>
        </div>

        <div class="admin-form-row">
          <label>Fulfillment mode
            <select id="shared-fulfillmentMode">${fulfillmentOptions}</select>
          </label>
          <label id="shared-packageSize-field" ${fulfillmentNeedsPackageSize(shared.fulfillmentMode) ? '' : 'hidden'}>Package size
            <select id="shared-packageSize">${packageSizeOptions}</select>
          </label>
        </div>
        <div class="admin-form-row">
          <label>Weight — lb <input type="number" id="shared-packedWeightLb" min="0" step="0.1" value="${shared.packedWeightLb}"></label>
          <label>Weight — oz <input type="number" id="shared-packedWeightOz" min="0" max="15" step="1" value="${shared.packedWeightOz}"></label>
          <label>Length (in) <input type="number" id="shared-packageLengthIn" min="0" step="0.1" value="${shared.packageLengthIn ?? ''}"></label>
          <label>Width (in) <input type="number" id="shared-packageWidthIn" min="0" step="0.1" value="${shared.packageWidthIn ?? ''}"></label>
          <label>Height (in) <input type="number" id="shared-packageHeightIn" min="0" step="0.1" value="${shared.packageHeightIn ?? ''}"></label>
        </div>

        <label class="admin-form-checkbox">
          <input type="checkbox" id="shared-featured" ${shared.featured ? 'checked' : ''}>
          Featured
        </label>
      </div>

      <div class="admin-form-section">
        <h2 class="admin-form-section-title">Publish</h2>
        <div class="admin-batch-publish-choice">
          <label class="admin-form-checkbox">
            <input type="radio" name="publish-mode" value="draft" ${shared.publishMode === 'draft' ? 'checked' : ''}>
            Save as Draft
          </label>
          <label class="admin-form-checkbox">
            <input type="radio" name="publish-mode" value="publish" ${shared.publishMode === 'publish' ? 'checked' : ''}>
            Publish Now
          </label>
        </div>
        <p class="admin-notice">Sets the default status for every product below; you can still change an individual product's status on its card.</p>
      </div>

      <div class="admin-form-section">
        <h2 class="admin-form-section-title">Products (<span id="batch-card-count">${items.length}</span>)</h2>
        <div id="batch-cards"></div>
      </div>

      <div class="admin-form-actions">
        <button type="button" class="admin-btn admin-btn-primary" id="batch-submit-btn" ${items.length === 0 ? 'disabled' : ''}>Create ${items.length} Product${items.length === 1 ? '' : 's'}</button>
        <button type="button" class="admin-btn" data-action="cancel">Cancel</button>
      </div>
    `;

    wireEditingEvents();
    renderCards();
  }

  function namingPreviewText() {
    if (!shared.nameBase.trim()) return 'Enter a shared name to generate sequential product names (e.g. "Creature Lighter-001").';
    const start = nextSequenceStart(products.map((p) => p.name), shared.nameBase.trim());
    return `Next products will be named "${shared.nameBase.trim()}-${formatSequenceNumber(start)}" onward.`;
  }

  function wireEditingEvents() {
    root.querySelectorAll('[data-action="cancel"]').forEach((btn) => btn.addEventListener('click', onCancel));

    const dropzone = /** @type {HTMLElement} */ (root.querySelector('#batch-dropzone'));
    const fileInput = /** @type {HTMLInputElement} */ (root.querySelector('#batch-file-input'));
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) addFiles(fileInput.files);
      fileInput.value = '';
    });
    ['dragenter', 'dragover'].forEach((evt) =>
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add('admin-batch-dropzone-active');
      })
    );
    ['dragleave', 'drop'].forEach((evt) =>
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove('admin-batch-dropzone-active');
      })
    );
    dropzone.addEventListener('drop', (e) => {
      const dragEvent = /** @type {DragEvent} */ (e);
      if (dragEvent.dataTransfer?.files?.length) addFiles(dragEvent.dataTransfer.files);
    });

    root.querySelector('#batch-clear-btn').addEventListener('click', clearBatch);
    root.querySelector('#batch-template-apply').addEventListener('click', () => {
      const id = /** @type {HTMLSelectElement} */ (root.querySelector('#batch-template-select')).value;
      if (id) applyTemplate(id);
    });

    const bind = (id, key, parse = (v) => v) => {
      const el = /** @type {HTMLInputElement} */ (root.querySelector(`#shared-${id}`));
      el.addEventListener('input', () => {
        shared[key] = parse(el.type === 'checkbox' ? el.checked : el.value);
        if (key === 'nameBase') {
          renumber();
          root.querySelector('#batch-naming-preview').textContent = namingPreviewText();
          renderCards();
        } else {
          refreshAllCardHeaders();
        }
      });
    };
    bind('nameBase', 'nameBase');
    bind('priceCents', 'priceCents', (v) => Math.round((Number(v) || 0) * 100));
    bind('categoryId', 'categoryId');
    bind('quantity', 'quantity', (v) => Number(v) || 0);
    bind('shortDescription', 'shortDescription');
    bind('description', 'description');
    bind('materials', 'materials');
    bind('dimensions', 'dimensions');
    bind('packedWeightLb', 'packedWeightLb', (v) => Number(v) || 0);
    bind('packedWeightOz', 'packedWeightOz', (v) => Number(v) || 0);
    bind('packageLengthIn', 'packageLengthIn', (v) => (v === '' ? null : Number(v)));
    bind('packageWidthIn', 'packageWidthIn', (v) => (v === '' ? null : Number(v)));
    bind('packageHeightIn', 'packageHeightIn', (v) => (v === '' ? null : Number(v)));
    bind('featured', 'featured');

    const fulfillmentSelect = /** @type {HTMLSelectElement} */ (root.querySelector('#shared-fulfillmentMode'));
    fulfillmentSelect.addEventListener('change', () => {
      shared.fulfillmentMode = fulfillmentSelect.value;
      root.querySelector('#shared-packageSize-field').toggleAttribute('hidden', !fulfillmentNeedsPackageSize(shared.fulfillmentMode));
      refreshAllCardHeaders();
    });
    root.querySelector('#shared-packageSize').addEventListener('change', (e) => {
      shared.packageSize = /** @type {HTMLSelectElement} */ (e.target).value;
      refreshAllCardHeaders();
    });

    root.querySelectorAll('input[name="publish-mode"]').forEach((radioEl) => {
      const radio = /** @type {HTMLInputElement} */ (radioEl);
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        shared.publishMode = radio.value;
        localStorage.setItem(PUBLISH_MODE_KEY, shared.publishMode);
        refreshAllCardHeaders();
      });
    });

    root.querySelector('#batch-submit-btn').addEventListener('click', startSubmission);
  }

  function refreshAllCardHeaders() {
    items.forEach((item) => refreshCardHeader(item));
  }

  // ---- rendering: cards ----

  function renderCards() {
    const mount = root.querySelector('#batch-cards');
    const countEl = root.querySelector('#batch-count');
    const cardCountEl = root.querySelector('#batch-card-count');
    const submitBtn = /** @type {HTMLButtonElement} */ (root.querySelector('#batch-submit-btn'));
    const clearBtn = /** @type {HTMLButtonElement} */ (root.querySelector('#batch-clear-btn'));
    if (!mount) return;
    if (countEl) countEl.textContent = `${items.length} product${items.length === 1 ? '' : 's'}`;
    if (cardCountEl) cardCountEl.textContent = String(items.length);
    if (submitBtn) {
      submitBtn.textContent = `Create ${items.length} Product${items.length === 1 ? '' : 's'}`;
      submitBtn.disabled = items.length === 0;
    }
    if (clearBtn) clearBtn.disabled = items.length === 0;

    if (items.length === 0) {
      mount.innerHTML = '<p class="admin-empty">No images selected yet. Add photos above — each one becomes a product.</p>';
      return;
    }

    mount.innerHTML = items.map((item, index) => cardTemplate(item, index)).join('');
    items.forEach((item) => wireCardEvents(item));
  }

  function cardTemplate(item, index) {
    const expanded = expandedIds.has(item.id);
    const { readiness, blocking } = cardReadiness(item);
    const readinessLabel = { ready: 'Ready', needs_info: 'Needs Info', draft: 'Draft' }[readiness];
    const categoryOptions = categories
      .map((c) => `<option value="${c.id}" ${effectiveValue(item, 'categoryId') === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
      .join('');
    const statusOptions = STATUS_OPTIONS.map(([key, label]) => `<option value="${key}" ${effectiveStatus(item) === key ? 'selected' : ''}>${label}</option>`).join('');
    const mode = effectiveValue(item, 'fulfillmentMode');
    const fulfillmentOptions = FULFILLMENT_MODES.map(([key, label]) => `<option value="${key}" ${mode === key ? 'selected' : ''}>${label}</option>`).join('');
    const packageSizeOptions = PACKAGE_SIZES.map(([key, label]) => `<option value="${key}" ${effectiveValue(item, 'packageSize') === key ? 'selected' : ''}>${label}</option>`).join('');
    const reset = (field) => `<button type="button" class="admin-batch-reset" data-reset="${field}" ${Object.prototype.hasOwnProperty.call(item.overrides, field) ? '' : 'hidden'} title="Reset to shared value">&#8634;</button>`;

    return `
      <div class="admin-batch-card" data-item-id="${item.id}" draggable="true">
        <div class="admin-batch-card-row">
          <img src="${item.previewUrl}" alt="" class="admin-thumb admin-batch-thumb">
          <div class="admin-batch-card-main">
            <label class="admin-batch-name-label">Product name
              <input type="text" data-field="name" value="${escapeHtml(effectiveName(item))}">
            </label>
            <div class="admin-batch-card-summary">
              <span id="summary-price-${item.id}">${formatCents(Number(effectiveValue(item, 'priceCents')) || 0)}</span>
              <span id="summary-category-${item.id}">${escapeHtml(categories.find((c) => c.id === effectiveValue(item, 'categoryId'))?.name || 'No category')}</span>
              <span id="summary-qty-${item.id}">Qty ${Number(effectiveValue(item, 'quantity')) || 0}</span>
              <span id="summary-status-${item.id}" class="admin-status admin-status-${effectiveStatus(item)}">${effectiveStatus(item)}</span>
              <span id="summary-readiness-${item.id}" class="admin-readiness admin-readiness-${readiness}" title="${escapeHtml(blocking.map((b) => b.label).join(', '))}">${readinessLabel}</span>
            </div>
          </div>
          <div class="admin-batch-card-actions">
            <button type="button" class="admin-btn-sm" data-act="up" ${index === 0 ? 'disabled' : ''}>&uarr;</button>
            <button type="button" class="admin-btn-sm" data-act="down" ${index === items.length - 1 ? 'disabled' : ''}>&darr;</button>
            <button type="button" class="admin-btn-sm" data-act="expand">${expanded ? 'Collapse' : 'Edit Details'}</button>
            <button type="button" class="admin-btn-sm admin-btn-danger" data-act="remove">Remove</button>
          </div>
        </div>
        <div class="admin-batch-card-details" ${expanded ? '' : 'hidden'}>
          <div class="admin-form-row">
            <label>Price (USD) ${reset('priceCents')}
              <input type="number" min="0" step="0.01" data-field="priceCents" value="${(Number(effectiveValue(item, 'priceCents')) / 100 || 0).toFixed(2)}">
            </label>
            <label>Category ${reset('categoryId')}
              <select data-field="categoryId">
                <option value="">Select a category&hellip;</option>
                ${categoryOptions}
              </select>
            </label>
            <label>Quantity ${reset('quantity')}
              <input type="number" min="0" step="1" data-field="quantity" value="${Number(effectiveValue(item, 'quantity')) || 0}">
            </label>
            <label>Status ${reset('status')}
              <select data-field="status">${statusOptions}</select>
            </label>
          </div>
          <label>Short description ${reset('shortDescription')}
            <input type="text" data-field="shortDescription" value="${escapeHtml(effectiveValue(item, 'shortDescription') || '')}">
          </label>
          <label>Full description ${reset('description')}
            <textarea rows="2" data-field="description">${escapeHtml(effectiveValue(item, 'description') || '')}</textarea>
          </label>
          <div class="admin-form-row">
            <label>Materials ${reset('materials')}
              <input type="text" data-field="materials" value="${escapeHtml(effectiveValue(item, 'materials') || '')}">
            </label>
            <label>Dimensions ${reset('dimensions')}
              <input type="text" data-field="dimensions" value="${escapeHtml(effectiveValue(item, 'dimensions') || '')}">
            </label>
          </div>
          <div class="admin-form-row">
            <label>Fulfillment mode ${reset('fulfillmentMode')}
              <select data-field="fulfillmentMode">${fulfillmentOptions}</select>
            </label>
            <label ${fulfillmentNeedsPackageSize(mode) ? '' : 'hidden'}>Package size ${reset('packageSize')}
              <select data-field="packageSize">${packageSizeOptions}</select>
            </label>
          </div>
          <div class="admin-form-row">
            <label>Weight — lb ${reset('packedWeightLb')}<input type="number" min="0" step="0.1" data-field="packedWeightLb" value="${Number(effectiveValue(item, 'packedWeightLb')) || 0}"></label>
            <label>Weight — oz ${reset('packedWeightOz')}<input type="number" min="0" max="15" step="1" data-field="packedWeightOz" value="${Number(effectiveValue(item, 'packedWeightOz')) || 0}"></label>
            <label>Length (in) ${reset('packageLengthIn')}<input type="number" min="0" step="0.1" data-field="packageLengthIn" value="${effectiveValue(item, 'packageLengthIn') ?? ''}"></label>
            <label>Width (in) ${reset('packageWidthIn')}<input type="number" min="0" step="0.1" data-field="packageWidthIn" value="${effectiveValue(item, 'packageWidthIn') ?? ''}"></label>
            <label>Height (in) ${reset('packageHeightIn')}<input type="number" min="0" step="0.1" data-field="packageHeightIn" value="${effectiveValue(item, 'packageHeightIn') ?? ''}"></label>
          </div>
          <label class="admin-form-checkbox">
            <input type="checkbox" data-field="featured" ${effectiveValue(item, 'featured') ? 'checked' : ''}>
            Featured ${reset('featured')}
          </label>
        </div>
      </div>
    `;
  }

  function parseFieldValue(field, el) {
    if (field === 'featured') return el.checked;
    if (['priceCents'].includes(field)) return Math.round((Number(el.value) || 0) * 100);
    if (['quantity', 'packedWeightLb', 'packedWeightOz'].includes(field)) return Number(el.value) || 0;
    if (['packageLengthIn', 'packageWidthIn', 'packageHeightIn'].includes(field)) return el.value === '' ? null : Number(el.value);
    return el.value;
  }

  function wireCardEvents(item) {
    const card = root.querySelector(`.admin-batch-card[data-item-id="${item.id}"]`);
    if (!card) return;

    card.querySelector('[data-act="up"]')?.addEventListener('click', () => moveItem(item.id, -1));
    card.querySelector('[data-act="down"]')?.addEventListener('click', () => moveItem(item.id, 1));
    card.querySelector('[data-act="remove"]').addEventListener('click', () => removeItem(item.id));
    card.querySelector('[data-act="expand"]').addEventListener('click', () => {
      if (expandedIds.has(item.id)) expandedIds.delete(item.id);
      else expandedIds.add(item.id);
      renderCards();
    });

    card.addEventListener('dragstart', () => {
      draggedId = item.id;
    });
    card.addEventListener('dragover', (e) => e.preventDefault());
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!draggedId || draggedId === item.id) return;
      const from = items.findIndex((i) => i.id === draggedId);
      const to = items.findIndex((i) => i.id === item.id);
      if (from === -1 || to === -1) return;
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      draggedId = null;
      renumber();
      renderCards();
    });

    const nameInput = /** @type {HTMLInputElement} */ (card.querySelector('[data-field="name"]'));
    nameInput.addEventListener('input', () => {
      item.nameOverridden = true;
      item.overrides.name = nameInput.value;
      refreshCardHeader(item);
    });

    card.querySelectorAll('[data-field]').forEach((fieldEl) => {
      if (fieldEl === nameInput) return;
      const el = /** @type {HTMLInputElement} */ (fieldEl);
      const field = el.getAttribute('data-field');
      const handler = () => {
        item.overrides[field] = parseFieldValue(field, el);
        if (field === 'fulfillmentMode') {
          // Switching modes can change whether the package-size field applies — full re-render of this card's details panel.
          renderCards();
          return;
        }
        refreshCardHeader(item);
        const resetBtn = /** @type {HTMLElement} */ (card.querySelector(`[data-reset="${field}"]`));
        if (resetBtn) resetBtn.hidden = false;
      };
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', handler);
    });

    card.querySelectorAll('[data-reset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        delete item.overrides[btn.getAttribute('data-reset')];
        renderCards();
      });
    });
  }

  function refreshCardHeader(item) {
    const priceEl = root.querySelector(`#summary-price-${item.id}`);
    const categoryEl = root.querySelector(`#summary-category-${item.id}`);
    const qtyEl = root.querySelector(`#summary-qty-${item.id}`);
    const statusEl = /** @type {HTMLElement} */ (root.querySelector(`#summary-status-${item.id}`));
    const readinessEl = /** @type {HTMLElement} */ (root.querySelector(`#summary-readiness-${item.id}`));
    if (!priceEl) return;
    priceEl.textContent = formatCents(Number(effectiveValue(item, 'priceCents')) || 0);
    categoryEl.textContent = categories.find((c) => c.id === effectiveValue(item, 'categoryId'))?.name || 'No category';
    qtyEl.textContent = `Qty ${Number(effectiveValue(item, 'quantity')) || 0}`;
    const status = effectiveStatus(item);
    statusEl.textContent = status;
    statusEl.className = `admin-status admin-status-${status}`;
    const { readiness, blocking } = cardReadiness(item);
    const readinessLabel = { ready: 'Ready', needs_info: 'Needs Info', draft: 'Draft' }[readiness];
    readinessEl.textContent = readinessLabel;
    readinessEl.className = `admin-readiness admin-readiness-${readiness}`;
    readinessEl.title = blocking.map((b) => b.label).join(', ');
  }

  // ---- submission ----

  function startSubmission() {
    if (items.length === 0) return;
    const el = /** @type {HTMLElement} */ (root.querySelector('#batch-validation-error'));

    if (items.some((item) => !effectiveName(item)?.trim())) {
      el.textContent = 'Every product needs a name — enter a shared product name above, or set one on each card.';
      el.hidden = false;
      return;
    }

    const blockedNames = [];
    for (const item of items) {
      if (effectiveStatus(item) !== 'available') continue;
      const { blocking } = cardReadiness(item);
      const reasons = blocking.map((b) => b.label);
      // readiness.js's packed-weight/dimensions checks are warning-severity (a
      // draft can be missing them) — the same hard "shippable product needs
      // positive packed data" rule productForm.js enforces on publish lives in
      // fulfillment.js's validatePackedShipping instead, so it has to be checked
      // here too, or a batch-published item could skip a check Add Product never lets through.
      const shape = buildProductShape(item);
      const mode = effectiveValue(item, 'fulfillmentMode');
      const packedError = validatePackedShipping(shape, { requirePositive: fulfillmentRequiresPackedData(mode) });
      if (packedError) reasons.push(packedError);
      if (reasons.length > 0) blockedNames.push(`${effectiveName(item)} (${reasons.join(', ')})`);
    }
    if (blockedNames.length > 0) {
      el.textContent = `Can't publish yet — fix or switch to Draft: ${blockedNames.join('; ')}.`;
      el.hidden = false;
      return;
    }
    el.hidden = true;

    async function createOne(item) {
      const fields = buildProductShape(item);
      if (!item.createdProduct) {
        let slug = slugify(fields.name);
        let attempt = 0;
        for (;;) {
          try {
            item.createdProduct = await onCreateProduct({ ...fields, slug });
            break;
          } catch (err) {
            if (isDuplicateSlugError(err) && attempt < 25) {
              attempt += 1;
              slug = `${slugify(fields.name)}-${attempt + 1}`;
              continue;
            }
            throw err;
          }
        }
      }
      if (!item.imageUploaded) {
        try {
          await onUploadImage(item.createdProduct.id, item.file, { isPrimary: true, sortOrder: 0 });
          item.imageUploaded = true;
        } catch (err) {
          throw new Error(
            `"${fields.name}" was created, but its photo failed to upload — Retry Failed will try the photo again, or add it later from Edit Product. (${err instanceof Error ? err.message : err})`
          );
        }
      }
      return item.createdProduct;
    }

    // `runner` must exist *before* phase flips to 'progress' and renderProgress()
    // runs — renderProgress() ends by calling updateProgressSummary(), which reads
    // runner.getSummary(). Building the runner first (and rendering only once it's
    // assigned) is what guarantees that invariant; getting this order backwards is
    // exactly what shipped as a bug: it threw on `runner.getSummary()` with runner
    // still null, so run() itself was never reached and the UI froze on "Starting…"
    // with every item stuck at "Pending" (see tests/shop/e2e/batch-upload.spec.js).
    runner = createBatchRunner({
      items,
      createOne,
      concurrency: 3,
      onItemUpdate: (state) => {
        const item = items.find((i) => i.id === state.id);
        if (!item) return;
        item.uiStatus = state.status;
        item.uiError = state.error;
        updateProgressRow(item);
      },
    });

    try {
      phase = 'progress';
      renderProgress();
    } catch (err) {
      // Defense in depth: if rendering the progress view itself throws for any
      // reason, fall back to a visible error instead of a silently frozen screen.
      console.error('Failed to render batch progress view', err);
      root.innerHTML = `<div class="admin-header"><h1>Batch Upload</h1></div><p class="admin-form-error">Something went wrong starting batch creation: ${escapeHtml(err instanceof Error ? err.message : String(err))}</p><div class="admin-form-actions"><button type="button" class="admin-btn" id="batch-error-back-btn">Back</button></div>`;
      root.querySelector('#batch-error-back-btn').addEventListener('click', () => {
        phase = 'editing';
        renderEditing();
      });
      return;
    }

    runProgress(runner.run());
  }

  async function runProgress(promise) {
    try {
      await promise;
    } catch (err) {
      // createBatchRunner's own per-item try/catch should make this unreachable
      // in practice, but if run() ever rejects unexpectedly, the finally below
      // still pulls the summary off "Starting…" instead of leaving it frozen.
      console.error('Batch run failed unexpectedly', err);
    } finally {
      updateProgressSummary();
    }
  }

  function renderProgress() {
    root.innerHTML = `
      <div class="admin-header">
        <h1>Batch Upload — Creating Products</h1>
      </div>
      <p class="admin-notice" id="batch-progress-summary">Starting&hellip;</p>
      <div class="admin-batch-progress-list" id="batch-progress-list">
        ${items.map((item) => progressRowTemplate(item)).join('')}
      </div>
      <div class="admin-form-actions">
        <button type="button" class="admin-btn admin-btn-primary" id="batch-retry-btn" hidden>Retry Failed</button>
        <button type="button" class="admin-btn" id="batch-finish-btn" disabled>Return to Products</button>
      </div>
    `;
    root.querySelector('#batch-finish-btn').addEventListener('click', onDone);
    root.querySelector('#batch-retry-btn').addEventListener('click', async () => {
      const retryBtn = /** @type {HTMLButtonElement} */ (root.querySelector('#batch-retry-btn'));
      const finishBtn = /** @type {HTMLButtonElement} */ (root.querySelector('#batch-finish-btn'));
      retryBtn.disabled = true;
      finishBtn.disabled = true;
      await runner.retryFailed();
      updateProgressSummary();
    });
    updateProgressSummary();
  }

  function progressRowTemplate(item) {
    return `
      <div class="admin-batch-progress-row" id="progress-row-${item.id}" data-status="${item.uiStatus}">
        <img src="${item.previewUrl}" alt="" class="admin-thumb admin-batch-thumb">
        <span class="admin-batch-progress-name">${escapeHtml(effectiveName(item))}</span>
        <span class="admin-batch-progress-status" id="progress-status-${item.id}">${progressStatusLabel(item)}</span>
        ${item.uiError ? `<p class="admin-batch-progress-error">${escapeHtml(item.uiError)}</p>` : ''}
      </div>
    `;
  }

  function progressStatusLabel(item) {
    return { idle: 'Pending', pending: 'Pending', running: 'Creating&hellip;', done: 'Created', failed: 'Failed' }[item.uiStatus] || item.uiStatus;
  }

  function updateProgressRow(item) {
    const row = root.querySelector(`#progress-row-${item.id}`);
    if (!row) return;
    row.setAttribute('data-status', item.uiStatus);
    row.querySelector(`#progress-status-${item.id}`).innerHTML = progressStatusLabel(item);
    const existingError = row.querySelector('.admin-batch-progress-error');
    if (existingError) existingError.remove();
    if (item.uiError) {
      const p = document.createElement('p');
      p.className = 'admin-batch-progress-error';
      p.textContent = item.uiError;
      row.appendChild(p);
    }
    updateProgressSummary();
  }

  function updateProgressSummary() {
    const summary = runner.getSummary();
    const el = root.querySelector('#batch-progress-summary');
    const retryBtn = /** @type {HTMLButtonElement} */ (root.querySelector('#batch-retry-btn'));
    const finishBtn = /** @type {HTMLButtonElement} */ (root.querySelector('#batch-finish-btn'));
    if (!el) return;
    const running = runner.isRunning();
    el.textContent = running
      ? `Creating products&hellip; ${summary.succeeded} done, ${summary.failed} failed, ${summary.pending} remaining.`
      : `${summary.succeeded} of ${items.length} product${items.length === 1 ? '' : 's'} created successfully${summary.failed > 0 ? `, ${summary.failed} failed` : ''}.`;
    if (retryBtn) {
      retryBtn.hidden = summary.failed === 0;
      retryBtn.disabled = running;
    }
    if (finishBtn) finishBtn.disabled = running;
  }

  render();
  return { element: root };
}
