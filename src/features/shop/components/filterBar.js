/**
 * @param {import('../types/typedefs.js').ShopCategory[]} categories
 * @param {{activeSlug?: string|null, onSelect: (slug: string|null) => void}} opts
 * @returns {HTMLElement}
 */
export function createFilterBar(categories, { activeSlug = null, onSelect }) {
  const nav = document.createElement('div');
  nav.className = 'gallery-categories';

  const makeButton = (label, slug) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'category-btn';
    btn.textContent = label;
    btn.dataset.categorySlug = slug || '';
    if (slug === activeSlug) btn.classList.add('active');
    btn.addEventListener('click', () => onSelect(slug));
    return btn;
  };

  nav.appendChild(makeButton('All', null));
  categories.forEach((category) => nav.appendChild(makeButton(category.name, category.slug)));

  return nav;
}
