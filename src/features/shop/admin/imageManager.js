import { validateImageFile } from './imageProcessing.js';
import { uploadProductImage, adminDeleteProductImage, adminSetPrimaryImage, adminReorderImages } from './api.js';

/**
 * Admin image management widget, shared between Add Product (no product
 * row yet — files are only staged locally, in-memory, until the form is
 * submitted) and Edit Product (product exists — every action persists to
 * Supabase immediately).
 *
 * @param {{mode: 'staged'|'persisted', productId?: string, images?: any[], onError?: (msg:string)=>void}} opts
 * @returns {{element: HTMLElement, getStagedFiles: () => {file: File, isPrimary: boolean}[]}}
 */
export function createImageManager({ mode, productId, images = [], onError = () => {} }) {
  const wrap = document.createElement('div');
  wrap.className = 'admin-image-manager';

  /** @type {{id?: string, file?: File, url: string, storagePath?: string, isPrimary: boolean, status: string}[]} */
  let items = images
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((img) => ({ id: img.id, url: img.url, storagePath: img.storagePath, isPrimary: img.isPrimary, status: 'ready' }));

  const listEl = document.createElement('div');
  listEl.className = 'admin-image-list';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/jpeg,image/png,image/webp';
  fileInput.multiple = true;
  fileInput.className = 'admin-image-file-input';
  fileInput.id = `admin-image-input-${Math.random().toString(36).slice(2)}`;

  const addLabel = document.createElement('label');
  addLabel.className = 'admin-btn admin-image-add-btn';
  addLabel.textContent = '+ Add Images';
  addLabel.setAttribute('for', fileInput.id);

  wrap.appendChild(listEl);
  wrap.appendChild(addLabel);
  wrap.appendChild(fileInput);

  function render() {
    listEl.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'admin-image-empty';
      empty.textContent = 'No images yet.';
      listEl.appendChild(empty);
      return;
    }

    items.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'admin-image-card';
      const busy = item.status !== 'ready';
      card.innerHTML = `
        <div class="admin-image-thumb-wrap">
          <img src="${item.url}" alt="" class="admin-image-thumb${busy ? ' admin-image-uploading' : ''}">
          ${item.isPrimary ? '<span class="admin-image-primary-badge">Primary</span>' : ''}
          ${busy ? '<span class="admin-image-status">Uploading&hellip;</span>' : ''}
        </div>
        <div class="admin-image-card-actions">
          <button type="button" class="admin-btn-sm" data-act="primary" ${item.isPrimary || busy ? 'disabled' : ''}>Set Primary</button>
          <button type="button" class="admin-btn-sm" data-act="up" ${index === 0 || busy ? 'disabled' : ''}>Move Up</button>
          <button type="button" class="admin-btn-sm" data-act="down" ${index === items.length - 1 || busy ? 'disabled' : ''}>Move Down</button>
          <button type="button" class="admin-btn-sm admin-btn-danger" data-act="delete" ${busy ? 'disabled' : ''}>Delete</button>
        </div>
      `;
      card.querySelector('[data-act="primary"]').addEventListener('click', () => setPrimary(item));
      card.querySelector('[data-act="up"]').addEventListener('click', () => move(index, -1));
      card.querySelector('[data-act="down"]').addEventListener('click', () => move(index, 1));
      card.querySelector('[data-act="delete"]').addEventListener('click', () => remove(item));
      listEl.appendChild(card);
    });
  }

  async function setPrimary(item) {
    if (mode === 'persisted') {
      try {
        await adminSetPrimaryImage(productId, item.id);
      } catch (err) {
        console.error('Set primary failed', err);
        onError('Could not set that as the primary image. Please try again.');
        return;
      }
    }
    items.forEach((i) => { i.isPrimary = i === item; });
    render();
  }

  async function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    render();
    if (mode === 'persisted') {
      try {
        await adminReorderImages(items.map((i) => i.id));
      } catch (err) {
        console.error('Reorder failed', err);
        onError('Could not save the new image order. Please try again.');
      }
    }
  }

  async function remove(item) {
    if (!window.confirm('Remove this image?')) return;
    if (mode === 'persisted') {
      try {
        await adminDeleteProductImage(item);
      } catch (err) {
        console.error('Delete image failed', err);
        onError('Could not remove that image. Please try again.');
        return;
      }
    } else if (item.url) {
      URL.revokeObjectURL(item.url);
    }
    items = items.filter((i) => i !== item);
    render();
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    for (const file of files) {
      const result = validateImageFile(file);
      if (!result.ok) {
        onError(result.error);
        continue;
      }

      if (mode === 'staged') {
        items.push({ file, url: URL.createObjectURL(file), isPrimary: items.length === 0, status: 'ready' });
        render();
        continue;
      }

      // Persisted mode: show an instant local preview while the real
      // upload (resize + Storage + DB insert) happens in the background.
      const placeholder = { url: URL.createObjectURL(file), isPrimary: items.length === 0, status: 'uploading' };
      items.push(placeholder);
      render();
      try {
        const uploaded = await uploadProductImage(productId, file, {
          isPrimary: placeholder.isPrimary,
          sortOrder: items.length - 1,
        });
        URL.revokeObjectURL(placeholder.url);
        Object.assign(placeholder, uploaded, { status: 'ready' });
        render();
      } catch (err) {
        console.error('Upload failed', err);
        onError(err.message || `Could not upload "${file.name}". Please try again.`);
        URL.revokeObjectURL(placeholder.url);
        items = items.filter((i) => i !== placeholder);
        render();
      }
    }
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFiles(fileInput.files);
    fileInput.value = '';
  });

  render();

  return {
    element: wrap,
    getStagedFiles: () => items.map((i) => ({ file: i.file, isPrimary: i.isPrimary })),
  };
}
