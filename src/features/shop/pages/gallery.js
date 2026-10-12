import { getGallerySections, getGallerySectionItems, getAllWorkItems } from '../api/gallery.js';
import { escapeHtml } from '../dom.js';

const grid = document.getElementById('gallery-grid');
const statusEl = document.getElementById('gallery-status');
const introEl = document.querySelector('.gallery-intro');
const lightbox = document.getElementById('lightbox');
const lightboxImage = /** @type {HTMLImageElement} */ (document.getElementById('lightbox-image'));
const lightboxCounter = document.getElementById('lightbox-counter');

/** @type {import('../types/typedefs.js').GalleryItem[]} */
let items = [];
let currentIndex = 0;

function renderGrid() {
  grid.className = 'gallery-grid gallery-masonry';
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

function renderSectionCards(sections) {
  grid.className = 'gallery-grid gallery-masonry';
  grid.innerHTML = '';
  sections.forEach((section) => {
    const link = document.createElement('a');
    link.className = 'gallery-item gallery-section-card';
    link.href = `/gallery?section=${encodeURIComponent(section.slug)}`;
    link.innerHTML = `
      ${section.coverUrl
        ? `<img src="${escapeHtml(section.coverUrl)}" alt="" loading="lazy">`
        : '<span class="specimen-image placeholder"><span>No Image</span></span>'}
      <div class="gallery-section-info">
        <span class="gallery-section-name">${escapeHtml(section.name)}</span>
        <span class="gallery-section-count">${section.itemCount} ITEM${section.itemCount === 1 ? '' : 'S'}</span>
      </div>
    `;
    grid.appendChild(link);
  });
}

function renderEmpty(message) {
  grid.className = 'gallery-grid gallery-masonry';
  const empty = document.createElement('p');
  empty.className = 'shop-empty';
  empty.textContent = message;
  grid.replaceChildren(empty);
}

function renderError() {
  grid.className = 'gallery-grid gallery-masonry';
  grid.innerHTML = '<p class="data-placeholder">Something went wrong loading the gallery. Please try again later.</p>';
}

/** Shows (or clears) a "← back" control above the grid — only the section/all-work views have one. */
function setBackLink(label, href) {
  let backEl = /** @type {HTMLAnchorElement} */ (document.getElementById('gallery-back-link'));
  if (!label) {
    backEl?.remove();
    return;
  }
  if (!backEl) {
    backEl = document.createElement('a');
    backEl.id = 'gallery-back-link';
    backEl.className = 'gallery-back-link';
    introEl.insertAdjacentElement('afterend', backEl);
  }
  backEl.href = href;
  backEl.textContent = label;
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

async function showLanding() {
  document.title = 'Gallery - Creature Corner';
  setBackLink(null);
  statusEl.textContent = 'Loading sections…';
  let sections;
  try {
    sections = await getGallerySections();
  } catch (err) {
    console.error('Failed to load gallery sections', err);
    statusEl.textContent = 'Unable to load the gallery right now.';
    renderError();
    return;
  }

  if (sections.length === 0) {
    statusEl.textContent = 'SPECIMEN ARCHIVE // 0 SECTIONS';
    renderEmpty('No gallery sections documented yet — check back soon.');
    return;
  }

  statusEl.textContent = `SPECIMEN ARCHIVE // ${sections.length} SECTION${sections.length === 1 ? '' : 'S'}`;
  setBackLink('VIEW ALL WORK →', '/gallery?section=all');
  renderSectionCards(sections);
}

async function showAllWork() {
  document.title = 'All Work - Gallery - Creature Corner';
  statusEl.textContent = 'Loading specimens…';
  try {
    items = await getAllWorkItems();
  } catch (err) {
    console.error('Failed to load gallery', err);
    statusEl.textContent = 'Unable to load the gallery right now.';
    setBackLink('← All Sections', '/gallery');
    renderError();
    return;
  }

  setBackLink('← All Sections', '/gallery');
  if (items.length === 0) {
    statusEl.textContent = 'SPECIMEN ARCHIVE // 0 DOCUMENTED';
    renderEmpty('No specimens documented yet — check back soon.');
    return;
  }
  statusEl.textContent = `ALL WORK // ${items.length} DOCUMENTED`;
  renderGrid();
}

async function showSection(slug) {
  statusEl.textContent = 'Loading specimens…';
  setBackLink('← All Sections', '/gallery');
  let section;
  try {
    section = await getGallerySectionItems(slug);
  } catch (err) {
    console.error('Failed to load gallery section', err);
    document.title = 'Gallery - Creature Corner';
    statusEl.textContent = 'Unable to load the gallery right now.';
    renderError();
    return;
  }

  if (!section) {
    document.title = 'Gallery - Creature Corner';
    statusEl.textContent = 'SECTION NOT FOUND';
    renderEmpty('This gallery section could not be found. It may have been renamed or removed.');
    return;
  }

  document.title = `${section.name} - Gallery - Creature Corner`;
  items = section.items;
  if (items.length === 0) {
    statusEl.textContent = `${section.name.toUpperCase()} // 0 DOCUMENTED`;
    renderEmpty('No specimens documented yet in this section — check back soon.');
    return;
  }
  statusEl.textContent = `${section.name.toUpperCase()} // ${items.length} DOCUMENTED`;
  renderGrid();
}

async function init() {
  const section = new URLSearchParams(location.search).get('section');
  if (!section) await showLanding();
  else if (section === 'all') await showAllWork();
  else await showSection(section);
}

init();
