import { formatCents } from '../money.js';
import { escapeHtml } from '../dom.js';
import { pickPrimaryImage } from '../primaryImage.js';
import { getAvailabilityLabel, getAvailabilityVariant } from '../availability.js';

/**
 * @param {import('../types/typedefs.js').Product} product
 * @returns {HTMLElement}
 */
export function createProductCard(product) {
  const variant = getAvailabilityVariant(product);
  const label = getAvailabilityLabel(product);
  const primaryImage = pickPrimaryImage(product.images);
  const categoryLabel = (product.category?.name || 'Uncategorized').toUpperCase();
  const href = `/product/${product.slug}`;

  const article = document.createElement('article');
  article.className = 'specimen-card product-card';
  article.dataset.categorySlug = product.category?.slug || '';
  article.dataset.status = variant;

  article.innerHTML = `
    <a href="${href}" class="specimen-image-link" aria-label="View ${escapeHtml(product.name)}">
      <div class="specimen-image${primaryImage ? '' : ' placeholder'}">
        ${primaryImage
          ? `<img src="${escapeHtml(primaryImage.url)}" alt="${escapeHtml(product.name)}" loading="lazy">`
          : '<span>No Image</span>'}
      </div>
    </a>
    <div class="specimen-info">
      <div class="specimen-number">${escapeHtml(categoryLabel)}</div>
      <h3 class="specimen-title"><a href="${href}">${escapeHtml(product.name)}</a></h3>
      ${product.shortDescription ? `<p class="specimen-desc">${escapeHtml(product.shortDescription)}</p>` : ''}
      <div class="specimen-card-footer">
        <span class="specimen-price">${formatCents(product.priceCents)}</span>
        <span class="specimen-status ${variant}">${escapeHtml(label)}</span>
      </div>
    </div>
  `;

  return article;
}
