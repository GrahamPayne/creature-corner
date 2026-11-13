import { getCategories, getProducts } from '../api/products.js';
import { createProductCard } from '../components/productCard.js';
import { buildCategoryTiles } from '../categoryTiles.js';
import { escapeHtml } from '../dom.js';
import { syncNavBadge } from '../cart/navBadge.js';

const grid = document.getElementById('shop-grid');
const statusEl = document.getElementById('shop-status');
const introEl = document.querySelector('.gallery-intro');

function categorySlugFromUrl() {
  return new URLSearchParams(location.search).get('category');
}

/** Shows (or clears) a "← back" control above the grid — mirrors gallery.js's identical pattern; only the category view has one. */
function setBackLink(label, href) {
  let backEl = /** @type {HTMLAnchorElement} */ (document.getElementById('shop-back-link'));
  if (!label) {
    backEl?.remove();
    return;
  }
  if (!backEl) {
    backEl = document.createElement('a');
    backEl.id = 'shop-back-link';
    backEl.className = 'shop-back-link';
    introEl.insertAdjacentElement('afterend', backEl);
  }
  backEl.href = href;
  backEl.textContent = label;
}

function renderCategoryTiles(tiles) {
  grid.innerHTML = '';
  tiles.forEach((tile) => {
    const link = document.createElement('a');
    link.className = 'specimen-card shop-category-card';
    link.href = `/shop?category=${encodeURIComponent(tile.slug)}`;
    link.innerHTML = `
      <div class="specimen-image${tile.coverUrl ? '' : ' placeholder'}">
        ${tile.coverUrl ? `<img src="${escapeHtml(tile.coverUrl)}" alt="" loading="lazy">` : '<span>No Image</span>'}
      </div>
      <div class="shop-category-info">
        <span class="shop-category-name">${escapeHtml(tile.name)}</span>
        <span class="shop-category-count">${tile.count} ITEM${tile.count === 1 ? '' : 'S'}</span>
      </div>
    `;
    grid.appendChild(link);
  });
}

function renderProductGrid(products) {
  grid.innerHTML = '';
  if (products.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'shop-empty';
    empty.textContent = 'No items in this category yet — check back soon.';
    grid.appendChild(empty);
    return;
  }
  products.forEach((product) => grid.appendChild(createProductCard(product)));
}

function renderEmptyNotice(message) {
  grid.innerHTML = '';
  const empty = document.createElement('p');
  empty.className = 'shop-empty';
  empty.textContent = message;
  grid.appendChild(empty);
}

async function showOverview() {
  document.title = 'Shop - Creature Corner';
  setBackLink(null);
  statusEl.textContent = 'Loading specimens…';

  let categories, products;
  try {
    [categories, products] = await Promise.all([getCategories(), getProducts()]);
  } catch (err) {
    console.error('Failed to load shop categories', err);
    statusEl.textContent = 'Unable to load the shop right now.';
    renderEmptyNotice('Something went wrong loading the shop. Please try again later.');
    return;
  }

  const tiles = buildCategoryTiles(categories, products);
  if (tiles.length === 0) {
    statusEl.textContent = 'SHOP // 0 CATEGORIES';
    renderEmptyNotice('Nothing in the shop yet — check back soon.');
    return;
  }

  statusEl.textContent = `SHOP // ${tiles.length} CATEGOR${tiles.length === 1 ? 'Y' : 'IES'}`;
  renderCategoryTiles(tiles);
}

async function showCategory(slug) {
  setBackLink('← All Categories', '/shop');
  statusEl.textContent = 'Loading specimens…';

  let categories, products;
  try {
    [categories, products] = await Promise.all([getCategories(), getProducts({ categorySlug: slug })]);
  } catch (err) {
    console.error('Failed to load shop category', err);
    document.title = 'Shop - Creature Corner';
    statusEl.textContent = 'Unable to load the shop right now.';
    renderEmptyNotice('Something went wrong loading this category. Please try again later.');
    return;
  }

  const category = categories.find((c) => c.slug === slug);
  // A category with zero publicly-visible products (unknown slug, or a
  // real category holding only drafts) is never shown as if it were a
  // real, browsable category — same rule the overview's tiles enforce.
  if (!category || products.length === 0) {
    document.title = 'Shop - Creature Corner';
    statusEl.textContent = 'CATEGORY NOT FOUND';
    renderEmptyNotice('This category could not be found. It may be renamed, empty, or removed.');
    return;
  }

  document.title = `${category.name} - Shop - Creature Corner`;
  statusEl.textContent = `${category.name.toUpperCase()} // ${products.length} ITEM${products.length === 1 ? '' : 'S'}`;
  renderProductGrid(products);
}

async function init() {
  syncNavBadge();
  const slug = categorySlugFromUrl();
  if (!slug) await showOverview();
  else await showCategory(slug);
}

init();
