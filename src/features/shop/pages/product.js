import { getProductBySlug } from '../api/products.js';
import { formatCents } from '../money.js';
import { escapeHtml } from '../dom.js';

const mount = document.getElementById('product-mount');

const SHIPPING_LABELS = {
  small: 'Small parcel',
  medium: 'Medium parcel',
  large: 'Large parcel',
  oversized: 'Oversized / freight',
  pickup_only: 'Local pickup only',
};

function slugFromUrl() {
  // Production/wrangler: Cloudflare rewrites /product/:slug to this page
  // via a 200 rewrite, which leaves location.pathname as the original
  // /product/<slug> untouched (see _redirects). Check that first.
  const pathParts = location.pathname.split('/').filter(Boolean);
  if (pathParts.length >= 2 && pathParts[0] === 'product') {
    return decodeURIComponent(pathParts[1]);
  }
  // Local/manual testing: /product.html?slug=... or /product?slug=...
  return new URLSearchParams(location.search).get('slug');
}

function renderNotFound() {
  mount.innerHTML = `
    <div class="specimen-entry">
      <p class="data-placeholder">This specimen could not be found. It may have sold, been removed, or the link is incorrect.</p>
      <p><a href="/shop" class="btn btn-secondary">Back to Shop</a></p>
    </div>
  `;
}

function renderProduct(product) {
  const isSold = product.status === 'sold' || product.quantity <= 0;
  const images = product.images.length ? product.images : [{ url: null, isPrimary: true }];
  const primary = images.find((img) => img.isPrimary) || images[0];

  const dataItems = [
    product.dimensions ? ['Dimensions', product.dimensions] : null,
    product.materials ? ['Materials', product.materials] : null,
    ['Category', product.category?.name || '—'],
    ['Quantity Available', isSold ? 0 : product.quantity],
    ['Shipping', SHIPPING_LABELS[product.shippingClass] || product.shippingClass],
    ['Local Pickup', product.pickupAvailable ? 'Available' : 'Not available'],
  ].filter(Boolean);

  mount.innerHTML = `
    <div class="specimen-entry">
      <div class="product-gallery">
        <div class="product-gallery-main specimen-image${primary.url ? '' : ' placeholder'}">
          ${primary.url
            ? `<img id="product-main-image" src="${escapeHtml(primary.url)}" alt="${escapeHtml(product.name)}">`
            : '<span>No Image</span>'}
        </div>
        ${images.length > 1 ? `
          <div class="product-gallery-thumbs">
            ${images.map((img, i) => `
              <button type="button" class="product-thumb${img.url === primary.url ? ' active' : ''}" data-image-url="${escapeHtml(img.url || '')}">
                <img src="${escapeHtml(img.url || '')}" alt="${escapeHtml(product.name)} view ${i + 1}">
              </button>
            `).join('')}
          </div>` : ''}
      </div>

      <header class="specimen-header">
        <div class="specimen-meta">
          <span class="specimen-id">${escapeHtml((product.category?.name || 'UNCATEGORIZED').toUpperCase())}</span>
          ${product.featured ? '<span class="specimen-category">FEATURED</span>' : ''}
        </div>
        <h1 class="specimen-name">${escapeHtml(product.name)}</h1>
        <span class="specimen-badge${isSold ? '' : ' documented'}">${isSold ? 'SOLD' : 'AVAILABLE'}</span>
      </header>

      <div class="product-price">${formatCents(product.priceCents)}</div>

      ${product.description ? `<div class="data-section"><p>${escapeHtml(product.description)}</p></div>` : ''}

      <div class="specimen-data">
        <div class="data-grid">
          ${dataItems.map(([label, value]) => `
            <div class="data-item">
              <span class="data-label">${escapeHtml(label)}</span>
              <span class="data-value">${escapeHtml(value)}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="product-actions">
        <button type="button" class="btn btn-primary" id="product-buy-btn" disabled>
          ${isSold ? 'Sold' : 'Add to Cart'}
        </button>
        ${isSold ? '' : '<p class="product-note">Cart &amp; checkout are coming in a later update.</p>'}
      </div>
    </div>
  `;

  mount.querySelectorAll('.product-thumb').forEach((btnEl) => {
    const btn = /** @type {HTMLElement} */ (btnEl);
    btn.addEventListener('click', () => {
      const url = btn.dataset.imageUrl;
      const mainImg = /** @type {HTMLImageElement|null} */ (document.getElementById('product-main-image'));
      if (mainImg && url) mainImg.src = url;
      mount.querySelectorAll('.product-thumb').forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
}

async function init() {
  const slug = slugFromUrl();
  if (!slug) {
    renderNotFound();
    return;
  }

  try {
    const product = await getProductBySlug(slug);
    if (!product) {
      renderNotFound();
      return;
    }
    document.title = `${product.name} - Creature Corner`;
    renderProduct(product);
  } catch (err) {
    console.error('Failed to load product', err);
    mount.innerHTML = '<p class="data-placeholder">Something went wrong loading this item. Please try again later.</p>';
  }
}

init();
