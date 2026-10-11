import { getGalleryItems } from '../api/gallery.js';
import { escapeHtml } from '../dom.js';

const grid = document.getElementById('gallery-grid');
const statusEl = document.getElementById('gallery-status');
const lightbox = document.getElementById('lightbox');
const lightboxImage = /** @type {HTMLImageElement} */ (document.getElementById('lightbox-image'));
const lightboxCounter = document.getElementById('lightbox-counter');

/** @type {import('../types/typedefs.js').GalleryItem[]} */
let items = [];
let currentIndex = 0;

function renderGrid() {
  grid.innerHTML = '';
  items.forEach((item, index) => {
    const article = document.createElement('article');
    article.className = 'gallery-item';
    article.dataset.index = String(index);
    const alt = item.altText || item.title || 'Gallery image';
    article.innerHTML = item.url
      ? `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(alt)}" loading="lazy">`
      : '<span class="specimen-image placeholder"><span>No Image</span></span>';
    article.addEventListener('click', () => openLightbox(index));
    grid.appendChild(article);
  });
}

function renderEmpty() {
  const empty = document.createElement('p');
  empty.className = 'shop-empty';
  empty.textContent = 'No specimens documented yet — check back soon.';
  grid.replaceChildren(empty);
}

function renderError() {
  grid.innerHTML = '<p class="data-placeholder">Something went wrong loading the gallery. Please try again later.</p>';
}

function openLightbox(index) {
  currentIndex = index;
  showCurrent();
  lightbox.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightbox.classList.remove('active');
  document.body.style.overflow = '';
}

function navigate(direction) {
  currentIndex = (currentIndex + direction + items.length) % items.length;
  showCurrent();
}

function showCurrent() {
  const item = items[currentIndex];
  lightboxImage.src = item.url || '';
  lightboxImage.alt = item.altText || item.title || 'Gallery image';
  lightboxCounter.textContent = `${currentIndex + 1} / ${items.length}`;
}

document.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
document.querySelector('.lightbox-prev').addEventListener('click', () => navigate(-1));
document.querySelector('.lightbox-next').addEventListener('click', () => navigate(1));
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if (!lightbox.classList.contains('active')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') navigate(-1);
  if (e.key === 'ArrowRight') navigate(1);
});

async function init() {
  statusEl.textContent = 'Loading specimens…';
  try {
    items = await getGalleryItems();
  } catch (err) {
    console.error('Failed to load gallery', err);
    statusEl.textContent = 'Unable to load the gallery right now.';
    renderError();
    return;
  }

  if (items.length === 0) {
    statusEl.textContent = 'SPECIMEN ARCHIVE // 0 DOCUMENTED';
    renderEmpty();
    return;
  }

  statusEl.textContent = `SPECIMEN ARCHIVE // ${items.length} DOCUMENTED`;
  renderGrid();
}

init();
