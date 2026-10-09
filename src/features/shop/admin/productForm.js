import { slugify } from './slug.js';
import { escapeHtml } from '../dom.js';
import { createImageManager } from './imageManager.js';
import { uploadProductImage } from './api.js';
import {
  FULFILLMENT_MODES,
  PACKAGE_SIZES,
  deriveFulfillmentMode,
  fulfillmentNeedsPackageSize,
  fulfillmentRequiresPackedData,
  resolveFulfillment,
  validatePackedShipping,
} from './fulfillment.js';
import { computeReadinessChecks, getBlockingIssues } from './readiness.js';

const STATUSES = [
  ['draft', 'Draft'],
  ['available', 'Available'],
  ['sold', 'Sold'],
  ['hidden', 'Hidden'],
];

/**
 * Reads the form's current (possibly incomplete/in-progress) values into
 * a product-shaped draft — the single source both the live readiness
 * checklist and the submit-time publish-safety check read from, so they
 * can never disagree with each other.
 * @param {HTMLFormElement} form
 * @param {{getImageCount: () => number}} imageManager
 */
function readDraftFromForm(form, imageManager) {
  const data = new FormData(form);
  const num = (name) => {
    const raw = data.get(name);
    return raw === null || raw === '' ? null : Number(raw);
  };

  let shippingClass = 'medium';
  let pickupAvailable = false;
  try {
    ({ shippingClass, pickupAvailable } = resolveFulfillment(String(data.get('fulfillmentMode')), String(data.get('packageSize') || 'medium')));
  } catch {
    // Mid-edit/unrecognized value — the checklist just falls back to a sensible default until the select settles.
  }

  return {
    priceCents: Math.round((Number(data.get('price')) || 0) * 100),
    categoryId: String(data.get('categoryId') || '') || null,
    quantity: Number(data.get('quantity')) || 0,
    shippingClass,
    pickupAvailable,
    shortDescription: String(data.get('shortDescription') || ''),
    description: String(data.get('description') || ''),
    materials: String(data.get('materials') || ''),
    dimensions: String(data.get('dimensions') || ''),
    packedWeightLb: num('packedWeightLb') || 0,
    packedWeightOz: num('packedWeightOz') || 0,
    packageLengthIn: num('packageLengthIn'),
    packageWidthIn: num('packageWidthIn'),
    packageHeightIn: num('packageHeightIn'),
    imageCount: imageManager.getImageCount(),
    status: String(data.get('status') || 'draft'),
  };
}

/**
 * onSubmit saves the product fields and resolves with the saved product —
 * it must NOT navigate away itself. onDone fires once everything, including
 * any staged image uploads for a new product, has actually finished; that's
 * the right time for the caller to navigate back to the dashboard.
 * @param {{categories: {id:string, slug:string, name:string}[], product?: any, shippingRates?: Record<string, number|null>, onSubmit: (fields: any) => Promise<any>, onDone: () => void, onCancel: () => void}} opts
 */
export function createProductForm({ categories, product, shippingRates = {}, onSubmit, onDone, onCancel }) {
  const isEdit = Boolean(product);
  const form = document.createElement('form');
  form.className = 'admin-form';

  const categoryOptions = categories
    .map((c) => `<option value="${c.id}" ${product?.category?.id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
  const statusOptions = STATUSES
    .map(([key, label]) => `<option value="${key}" ${(product?.status ?? 'draft') === key ? 'selected' : ''}>${label}</option>`)
    .join('');

  const initialMode = deriveFulfillmentMode(product);
  const initialPackageSize = PACKAGE_SIZES.some(([key]) => key === product?.shippingClass) ? product.shippingClass : 'medium';
  const fulfillmentOptions = FULFILLMENT_MODES
    .map(([key, label]) => `<option value="${key}" ${initialMode === key ? 'selected' : ''}>${label}</option>`)
    .join('');
  const packageSizeOptions = PACKAGE_SIZES
    .map(([key, label]) => `<option value="${key}" ${initialPackageSize === key ? 'selected' : ''}>${label}</option>`)
    .join('');

  form.innerHTML = `
    <p class="admin-form-error" hidden></p>
    <p class="admin-form-status" hidden></p>

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">Product Readiness</h2>
      <ul class="admin-readiness-checklist" id="readiness-checklist"></ul>
    </div>

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">Images</h2>
      <div id="image-manager-mount"></div>
    </div>

    <label>Product name
      <input type="text" name="name" required value="${escapeHtml(product?.name ?? '')}">
    </label>

    <label>URL slug
      <input type="text" name="slug" required value="${escapeHtml(product?.slug ?? '')}">
    </label>

    <label>Price (USD)
      <input type="number" name="price" required min="0" step="0.01" value="${product ? (product.priceCents / 100).toFixed(2) : ''}">
    </label>

    <label>Category
      <select name="categoryId" required>
        <option value="">Select a category&hellip;</option>
        ${categoryOptions}
      </select>
    </label>

    <label>Short description
      <input type="text" name="shortDescription" value="${escapeHtml(product?.shortDescription ?? '')}">
    </label>

    <label>Full description
      <textarea name="description" rows="4">${escapeHtml(product?.description ?? '')}</textarea>
    </label>

    <label>Dimensions
      <input type="text" name="dimensions" value="${escapeHtml(product?.dimensions ?? '')}">
    </label>

    <label>Materials
      <input type="text" name="materials" value="${escapeHtml(product?.materials ?? '')}">
    </label>

    <label>Quantity
      <input type="number" name="quantity" required min="0" step="1" value="${product?.quantity ?? 1}">
    </label>

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">Fulfillment</h2>
      <label>Fulfillment mode
        <select name="fulfillmentMode">${fulfillmentOptions}</select>
      </label>
      <label id="package-size-field" ${fulfillmentNeedsPackageSize(initialMode) ? '' : 'hidden'}>Package size
        <select name="packageSize">${packageSizeOptions}</select>
      </label>
      <p class="admin-notice" id="special-quote-note" ${initialMode === 'special_quote' ? '' : 'hidden'}>
        This product will never receive an automatic shipping price — the cart shows a manual-quote notice
        and checkout stays blocked until you follow up with the customer directly.
      </p>
    </div>

    <div class="admin-form-section">
      <h2 class="admin-form-section-title">Packed Shipping Info</h2>
      <p class="admin-notice">Enter the final packed box dimensions and weight, not the artwork dimensions.</p>
      <div class="admin-form-row">
        <label>Weight — lb
          <input type="number" name="packedWeightLb" min="0" step="0.1" value="${product?.packedWeightLb ?? 0}">
        </label>
        <label>Weight — oz
          <input type="number" name="packedWeightOz" min="0" max="15" step="1" value="${product?.packedWeightOz ?? 0}">
        </label>
      </div>
      <div class="admin-form-row">
        <label>Length (in)
          <input type="number" name="packageLengthIn" min="0" step="0.1" value="${product?.packageLengthIn ?? ''}">
        </label>
        <label>Width (in)
          <input type="number" name="packageWidthIn" min="0" step="0.1" value="${product?.packageWidthIn ?? ''}">
        </label>
        <label>Height (in)
          <input type="number" name="packageHeightIn" min="0" step="0.1" value="${product?.packageHeightIn ?? ''}">
        </label>
      </div>
    </div>

    <label class="admin-form-checkbox">
      <input type="checkbox" name="featured" ${product?.featured ? 'checked' : ''}>
      Featured
    </label>

    <label>Status
      <select name="status">${statusOptions}</select>
    </label>

    <div class="admin-form-actions">
      <button type="submit" class="admin-btn admin-btn-primary">${isEdit ? 'Save Changes' : 'Add Product'}</button>
      <button type="button" class="admin-btn" data-action="cancel">Cancel</button>
    </div>
  `;

  const nameInput = /** @type {HTMLInputElement} */ (form.elements.namedItem('name'));
  const slugInput = /** @type {HTMLInputElement} */ (form.elements.namedItem('slug'));
  const errorEl = /** @type {HTMLElement} */ (form.querySelector('.admin-form-error'));
  const statusEl = /** @type {HTMLElement} */ (form.querySelector('.admin-form-status'));

  const imageManager = createImageManager({
    mode: isEdit ? 'persisted' : 'staged',
    productId: product?.id,
    images: product?.images ?? [],
    onError: (message) => {
      errorEl.textContent = message;
      errorEl.hidden = false;
    },
  });
  form.querySelector('#image-manager-mount').appendChild(imageManager.element);

  const readinessList = /** @type {HTMLElement} */ (form.querySelector('#readiness-checklist'));
  function renderReadinessChecklist() {
    const draft = readDraftFromForm(form, imageManager);
    const checks = computeReadinessChecks(draft, { shippingRates });
    readinessList.innerHTML = checks
      .map((c) => `<li class="${c.ok ? 'ok' : 'warn'}">${c.ok ? '&#10003;' : '!'} ${escapeHtml(c.label)}${c.ok ? '' : ' missing' + (c.severity === 'blocking' ? ' (required to publish)' : '')}</li>`)
      .join('');
  }
  renderReadinessChecklist();
  // Click covers the image manager's add/delete/reorder/primary buttons
  // (type="button", so they don't fire 'change'); input/change covers
  // every text/select field, including the hidden file input itself.
  form.addEventListener('input', renderReadinessChecklist);
  form.addEventListener('change', renderReadinessChecklist);
  form.addEventListener('click', () => setTimeout(renderReadinessChecklist, 0));

  // Auto-suggest the slug from the name, but stop once the user has edited
  // the slug field themselves so we never clobber a manual choice.
  let slugTouched = isEdit;
  slugInput.addEventListener('input', () => { slugTouched = true; });
  nameInput.addEventListener('input', () => {
    if (!slugTouched) slugInput.value = slugify(nameInput.value);
  });

  form.querySelector('[data-action="cancel"]').addEventListener('click', onCancel);

  const fulfillmentSelect = /** @type {HTMLSelectElement} */ (form.elements.namedItem('fulfillmentMode'));
  const packageSizeField = form.querySelector('#package-size-field');
  const specialQuoteNote = form.querySelector('#special-quote-note');
  fulfillmentSelect.addEventListener('change', () => {
    packageSizeField.toggleAttribute('hidden', !fulfillmentNeedsPackageSize(fulfillmentSelect.value));
    specialQuoteNote.toggleAttribute('hidden', fulfillmentSelect.value !== 'special_quote');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const data = new FormData(form);
    const fulfillmentMode = String(data.get('fulfillmentMode'));
    const { shippingClass, pickupAvailable } = resolveFulfillment(fulfillmentMode, String(data.get('packageSize') || 'medium'));

    const packedLengthRaw = String(data.get('packageLengthIn') || '');
    const packedWidthRaw = String(data.get('packageWidthIn') || '');
    const packedHeightRaw = String(data.get('packageHeightIn') || '');
    const packed = {
      packedWeightLb: Number(data.get('packedWeightLb') || 0),
      packedWeightOz: Number(data.get('packedWeightOz') || 0),
      packageLengthIn: packedLengthRaw === '' ? null : Number(packedLengthRaw),
      packageWidthIn: packedWidthRaw === '' ? null : Number(packedWidthRaw),
      packageHeightIn: packedHeightRaw === '' ? null : Number(packedHeightRaw),
    };
    const packedError = validatePackedShipping(packed, { requirePositive: fulfillmentRequiresPackedData(fulfillmentMode) });
    if (packedError) {
      errorEl.textContent = packedError;
      errorEl.hidden = false;
      return;
    }

    const fields = {
      name: String(data.get('name') || '').trim(),
      slug: slugify(String(data.get('slug') || '')),
      priceCents: Math.round(Number(data.get('price')) * 100),
      categoryId: String(data.get('categoryId') || '') || null,
      shortDescription: String(data.get('shortDescription') || '').trim(),
      description: String(data.get('description') || '').trim(),
      dimensions: String(data.get('dimensions') || '').trim(),
      materials: String(data.get('materials') || '').trim(),
      quantity: Number(data.get('quantity')),
      shippingClass,
      pickupAvailable,
      ...packed,
      featured: data.get('featured') === 'on',
      status: String(data.get('status')),
    };

    if (!fields.slug) {
      errorEl.textContent = 'Slug cannot be empty.';
      errorEl.hidden = false;
      return;
    }

    // Draft/Hidden saves are never blocked — only the Available transition
    // is gated, and only on fields that are actually required for commerce
    // to function (see readiness.js). Same rule productTable.js's quick
    // "Mark Available"/"Publish" actions enforce, read from one place.
    if (fields.status === 'available') {
      const blocking = getBlockingIssues(computeReadinessChecks({ ...fields, imageCount: imageManager.getImageCount() }, { shippingRates }));
      if (blocking.length > 0) {
        errorEl.textContent = `Can't publish yet — still needed: ${blocking.map((c) => c.label).join(', ')}.`;
        errorEl.hidden = false;
        return;
      }
    }

    const submitBtn = /** @type {HTMLButtonElement} */ (form.querySelector('[type="submit"]'));
    submitBtn.disabled = true;
    try {
      const saved = await onSubmit(fields);

      // New products can't have images until the row (and its id) exists,
      // so staged files only get uploaded now, after a successful create —
      // and onDone() (which navigates away) waits until this is done too,
      // so any failure here is still visible to the admin.
      if (!isEdit) {
        const staged = imageManager.getStagedFiles();
        const failures = [];
        for (let i = 0; i < staged.length; i++) {
          statusEl.textContent = `Uploading image ${i + 1} of ${staged.length}…`;
          statusEl.hidden = false;
          try {
            await uploadProductImage(saved.id, staged[i].file, { isPrimary: staged[i].isPrimary, sortOrder: i });
          } catch (err) {
            console.error('Staged image upload failed', err);
            failures.push(staged[i].file.name);
          }
        }
        statusEl.hidden = true;
        if (failures.length > 0) {
          errorEl.textContent = `Product saved, but ${failures.length} image(s) failed to upload: ${failures.join(', ')}. You can add them from Edit.`;
          errorEl.hidden = false;
          submitBtn.disabled = false;
          return;
        }
      }
      onDone();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Something went wrong saving this product.';
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });

  return form;
}
