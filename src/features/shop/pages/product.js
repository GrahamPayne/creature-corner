import { getProductBySlug } from '../api/products.js';
import { formatCents } from '../money.js';
import { escapeHtml } from '../dom.js';
import { pickPrimaryImage } from '../primaryImage.js';
import { addToCart, readCart } from '../cart/cart.js';
import { syncNavBadge } from '../cart/navBadge.js';
import { getAvailabilityLabel, getAvailabilityVariant, getFulfillmentSummary } from '../availability.js';

const mount = document.getElementById('product-mount');

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
  const availabilityLabel = getAvailabilityLabel(product);
  const availabilityVariant = getAvailabilityVariant(product);
  const images = product.images.length ? product.images : [{ url: null, isPrimary: true }];
  const primary = pickPrimaryImage(product.images) || images[0];

  const dataItems = [
    product.dimensions ? ['Dimensions', product.dimensions] : null,
    product.materials ? ['Materials', product.materials] : null,
    ['Category', product.category?.name || '—'],
    // One-of-a-kind (qty 1) pieces don't need a "stock count" box — the
    // availability badge above already says whether it's purchasable.
    !isSold && product.quantity > 1 ? ['Quantity Available', product.quantity] : null,
    ['Fulfillment', getFulfillmentSummary(product)],
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
        <span class="specimen-badge ${availabilityVariant}">${escapeHtml(availabilityLabel.toUpperCase())}</span>
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
        <button type="button" class="btn btn-primary" id="product-buy-btn">
          ${isSold ? 'Sold' : 'Add to Cart'}
        </button>
        <p class="product-note" id="product-buy-note" hidden></p>
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

  wireBuyButton(product, isSold);
}

function wireBuyButton(product, isSold) {
  const btn = /** @type {HTMLButtonElement} */ (document.getElementById('product-buy-btn'));
  const note = /** @type {HTMLElement} */ (document.getElementById('product-buy-note'));

  function refresh() {
    if (isSold) {
      btn.disabled = true;
      return;
    }
    const inCart = readCart().find((i) => i.productId === product.id)?.quantity ?? 0;
    if (inCart >= product.quantity) {
      btn.disabled = true;
      btn.textContent = 'Max in Cart';
      note.textContent = `You already have all ${product.quantity} available in your cart.`;
      note.hidden = false;
    } else {
      btn.disabled = false;
      btn.textContent = 'Add to Cart';
      note.hidden = true;
    }
  }

  btn.addEventListener('click', () => {
    addToCart(product.id, 1, product.quantity);
    syncNavBadge();
    refresh();
    note.innerHTML = 'Added to cart. <a href="/cart">View Cart</a>';
    note.hidden = false;
  });

  refresh();
}

/** Creates the tag on first call, updates it on every later navigation — product.html is one static shell reused for every slug. */
function upsertMeta(attrName, attrValue, content) {
  let el = document.head.querySelector(`meta[${attrName}="${attrValue}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attrName, attrValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonical(href) {
  let el = /** @type {HTMLLinkElement} */ (document.head.querySelector('link[rel="canonical"]'));
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

function updateProductMeta(product) {
  const url = `https://creaturecorner.art/product/${product.slug}`;
  const description = product.shortDescription || product.description || `${product.name} — original art from Creature Corner.`;
  upsertMeta('name', 'description', description);
  upsertCanonical(url);
  upsertMeta('property', 'og:title', `${product.name} - Creature Corner`);
  upsertMeta('property', 'og:description', description);
  upsertMeta('property', 'og:url', url);
  upsertMeta('property', 'og:type', 'product');
  const primary = pickPrimaryImage(product.images);
  if (primary?.url) upsertMeta('property', 'og:image', primary.url);
}

async function init() {
  syncNavBadge();
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
    updateProductMeta(product);
    renderProduct(product);
  } catch (err) {
    console.error('Failed to load product', err);
    mount.innerHTML = '<p class="data-placeholder">Something went wrong loading this item. Please try again later.</p>';
  }
}

init();
