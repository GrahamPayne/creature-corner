import { getCategories, getProducts } from '../api/products.js';
import { createProductCard } from '../components/productCard.js';
import { createFilterBar } from '../components/filterBar.js';
import { syncNavBadge } from '../cart/navBadge.js';

const grid = document.getElementById('shop-grid');
const filterMount = document.getElementById('shop-filters');
const statusEl = document.getElementById('shop-status');

function categorySlugFromUrl() {
  return new URLSearchParams(location.search).get('category');
}

function renderGrid(products) {
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

function setActiveFilterButton(slug) {
  filterMount.querySelectorAll('.category-btn').forEach((btnEl) => {
    const btn = /** @type {HTMLElement} */ (btnEl);
    btn.classList.toggle('active', btn.dataset.categorySlug === (slug || ''));
  });
}

async function init() {
  syncNavBadge();
  statusEl.textContent = 'Loading specimens…';

  let categories;
  let products;
  try {
    [categories, products] = await Promise.all([getCategories(), getProducts()]);
  } catch (err) {
    console.error('Failed to load shop products', err);
    statusEl.textContent = 'Unable to load the shop right now.';
    grid.innerHTML = '<p class="shop-empty">Something went wrong loading products. Please try again later.</p>';
    return;
  }

  // Customers should never see a category filter button that leads to an
  // empty page — the Categories admin screen (adminListCategoriesWithCounts)
  // still shows every category for management; this is public-shop only.
  const categoriesWithProducts = categories.filter((c) => products.some((p) => p.category?.slug === c.slug));

  let activeSlug = categorySlugFromUrl();
  if (activeSlug && !categoriesWithProducts.some((c) => c.slug === activeSlug)) activeSlug = null;

  const applyFilter = (slug) => {
    const url = new URL(location.href);
    if (slug) url.searchParams.set('category', slug);
    else url.searchParams.delete('category');
    history.replaceState(null, '', url);

    setActiveFilterButton(slug);
    renderGrid(slug ? products.filter((p) => p.category?.slug === slug) : products);
  };

  filterMount.replaceChildren(createFilterBar(categoriesWithProducts, { activeSlug, onSelect: applyFilter }));

  statusEl.textContent = `ARCHIVE // ${products.length} ITEM${products.length === 1 ? '' : 'S'} LISTED`;
  renderGrid(activeSlug ? products.filter((p) => p.category?.slug === activeSlug) : products);
}

init();
