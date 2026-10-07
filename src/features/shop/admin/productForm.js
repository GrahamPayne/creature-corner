import { slugify } from './slug.js';
import { escapeHtml } from '../dom.js';
import { createImageManager } from './imageManager.js';
import { uploadProductImage } from './api.js';

const SHIPPING_CLASSES = [
  ['small', 'Small'],
  ['medium', 'Medium'],
  ['large', 'Large'],
  ['oversized', 'Oversized'],
  ['pickup_only', 'Local pickup only'],
];

const STATUSES = [
  ['draft', 'Draft'],
  ['available', 'Available'],
  ['sold', 'Sold'],
  ['hidden', 'Hidden'],
];

/**
 * onSubmit saves the product fields and resolves with the saved product —
 * it must NOT navigate away itself. onDone fires once everything, including
 * any staged image uploads for a new product, has actually finished; that's
 * the right time for the caller to navigate back to the dashboard.
 * @param {{categories: {id:string, slug:string, name:string}[], product?: any, onSubmit: (fields: any) => Promise<any>, onDone: () => void, onCancel: () => void}} opts
 */
export function createProductForm({ categories, product, onSubmit, onDone, onCancel }) {
  const isEdit = Boolean(product);
  const form = document.createElement('form');
  form.className = 'admin-form';

  const categoryOptions = categories
    .map((c) => `<option value="${c.id}" ${product?.category?.id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
  const shippingOptions = SHIPPING_CLASSES
    .map(([key, label]) => `<option value="${key}" ${product?.shippingClass === key ? 'selected' : ''}>${label}</option>`)
    .join('');
  const statusOptions = STATUSES
    .map(([key, label]) => `<option value="${key}" ${(product?.status ?? 'draft') === key ? 'selected' : ''}>${label}</option>`)
    .join('');

  form.innerHTML = `
    <p class="admin-form-error" hidden></p>
    <p class="admin-form-status" hidden></p>

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

    <label>Shipping class
      <select name="shippingClass">${shippingOptions}</select>
    </label>

    <label class="admin-form-checkbox">
      <input type="checkbox" name="pickupAvailable" ${product?.pickupAvailable ? 'checked' : ''}>
      Local pickup available
    </label>

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

  // Auto-suggest the slug from the name, but stop once the user has edited
  // the slug field themselves so we never clobber a manual choice.
  let slugTouched = isEdit;
  slugInput.addEventListener('input', () => { slugTouched = true; });
  nameInput.addEventListener('input', () => {
    if (!slugTouched) slugInput.value = slugify(nameInput.value);
  });

  form.querySelector('[data-action="cancel"]').addEventListener('click', onCancel);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const data = new FormData(form);
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
      shippingClass: String(data.get('shippingClass')),
      pickupAvailable: data.get('pickupAvailable') === 'on',
      featured: data.get('featured') === 'on',
      status: String(data.get('status')),
    };

    if (!fields.slug) {
      errorEl.textContent = 'Slug cannot be empty.';
      errorEl.hidden = false;
      return;
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
