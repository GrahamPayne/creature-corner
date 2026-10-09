import { isSupabaseConfigured } from '../api/config.js';
import { getSession, signIn, signOut, checkIsAdmin } from '../admin/auth.js';
import {
  adminListCategories,
  adminListProducts,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  adminDuplicateProduct,
  adminListShippingClasses,
  adminUpdateShippingRate,
  adminListCategoriesWithCounts,
  adminCreateCategory,
  adminUpdateCategory,
  adminReorderCategories,
  adminDeleteCategory,
  adminListOrders,
} from '../admin/api.js';
import { createProductForm } from '../admin/productForm.js';
import { createProductTable } from '../admin/productTable.js';
import { createShippingForm } from '../admin/shippingForm.js';
import { createCategoryManager } from '../admin/categoryManager.js';
import { createOrdersTable } from '../admin/ordersTable.js';
import { createOrderDetail } from '../admin/orderDetail.js';
import { escapeHtml } from '../dom.js';

const root = document.getElementById('admin-root');

const NAV_SECTIONS = [
  ['products', 'Products'],
  ['categories', 'Categories'],
  ['shipping', 'Shipping'],
  ['orders', 'Orders'],
];

function renderNotConfigured() {
  root.innerHTML = `
    <div class="admin-panel">
      <h1>Admin</h1>
      <p class="admin-notice">
        Supabase isn't connected yet, so there's nothing to manage here.
        See <code>docs/SHOP_SETUP.md</code> for the one-time setup steps.
      </p>
    </div>
  `;
}

/** @param {{error?: string}} [opts] */
function renderLogin({ error } = {}) {
  root.innerHTML = `
    <div class="admin-panel admin-panel-narrow">
      <h1>Admin Login</h1>
      <form class="admin-form" id="login-form">
        <p class="admin-form-error" ${error ? '' : 'hidden'}>${escapeHtml(error || '')}</p>
        <label>Email
          <input type="email" name="email" required autocomplete="username">
        </label>
        <label>Password
          <input type="password" name="password" required autocomplete="current-password">
        </label>
        <div class="admin-form-actions">
          <button type="submit" class="admin-btn admin-btn-primary">Log In</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(/** @type {HTMLFormElement} */ (e.target));
    const result = await signIn(String(data.get('email')), String(data.get('password')));
    if (!result.ok) {
      renderLogin({ error: result.error });
      return;
    }
    const isAdmin = await checkIsAdmin();
    if (!isAdmin) {
      await signOut();
      renderUnauthorized();
      return;
    }
    renderShell('products');
  });
}

function renderUnauthorized() {
  root.innerHTML = `
    <div class="admin-panel admin-panel-narrow">
      <h1>Admin</h1>
      <p class="admin-notice">This account is not authorized to manage the shop.</p>
      <button type="button" class="admin-btn" id="signout-btn">Sign Out</button>
    </div>
  `;
  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut();
    renderLogin();
  });
}

/**
 * Admin-only navigation (Products / Categories / Shipping / Orders) — lives
 * entirely inside #admin-root once logged in. Never touches the public
 * site's own nav (see tests/shop/e2e/admin.spec.js's "not linked from the
 * public nav" assertion, which this must keep passing).
 * @param {string} active
 */
function renderNav(active) {
  return `
    <nav class="admin-nav">
      ${NAV_SECTIONS.map(
        ([key, label]) => `<a href="#" class="admin-nav-link${active === key ? ' admin-nav-link-active' : ''}" data-section="${key}">${label}</a>`
      ).join('')}
      <button type="button" class="admin-btn admin-nav-signout" id="signout-btn">Sign Out</button>
    </nav>
  `;
}

/** Top-level shell: nav + a content mount that each section renders into. @param {string} section */
async function renderShell(section) {
  root.innerHTML = `
    <div class="admin-panel">
      <div id="admin-nav-mount"></div>
      <div id="admin-section-mount"></div>
    </div>
  `;
  await renderSection(section);
}

/** @param {string} section */
async function renderSection(section) {
  const navMount = document.getElementById('admin-nav-mount');
  navMount.innerHTML = renderNav(section);
  navMount.querySelectorAll('[data-section]').forEach((link) =>
    link.addEventListener('click', (e) => {
      e.preventDefault();
      renderSection(link.getAttribute('data-section'));
    })
  );
  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut();
    renderLogin();
  });

  const mount = document.getElementById('admin-section-mount');
  mount.innerHTML = '<p class="admin-notice">Loading&hellip;</p>';
  try {
    if (section === 'categories') await renderCategoriesSection(mount);
    else if (section === 'shipping') await renderShippingSection(mount);
    else if (section === 'orders') await renderOrdersSection(mount);
    else await renderProductsSection(mount);
  } catch (err) {
    console.error(`Failed to load admin section "${section}"`, err);
    mount.innerHTML = '<p class="admin-notice admin-notice-error">Could not load this section. Please refresh and try again.</p>';
  }
}

async function renderProductsSection(mount) {
  const [categories, initialProducts, shippingClasses] = await Promise.all([
    adminListCategories(),
    adminListProducts(),
    adminListShippingClasses(),
  ]);
  let products = initialProducts;
  // Readiness's "shippable product has a usable shipping configuration"
  // check (readiness.js) needs to know which flat rates are actually set.
  const shippingRates = Object.fromEntries(shippingClasses.map((c) => [c.key, c.flatPriceCents]));

  mount.innerHTML = `
    <div class="admin-header">
      <h1>Products</h1>
      <div class="admin-header-actions">
        <button type="button" class="admin-btn admin-btn-primary" id="add-product-btn">Add Product</button>
      </div>
    </div>
    <p id="admin-status" class="admin-notice">Loading products&hellip;</p>
    <div id="admin-table-mount"></div>
  `;

  const statusEl = mount.querySelector('#admin-status');
  const tableMount = mount.querySelector('#admin-table-mount');

  function refreshTable() {
    statusEl.textContent = `${products.length} product${products.length === 1 ? '' : 's'}`;
    tableMount.replaceChildren(
      createProductTable(products, {
        onEdit: (id) => showForm(products.find((p) => p.id === id)),
        onDuplicate: async (id) => {
          try {
            const created = await adminDuplicateProduct(id);
            products.unshift(created);
            refreshTable();
          } catch (err) {
            console.error('Duplicate failed', err);
            statusEl.textContent = 'Could not duplicate that product. Please try again.';
          }
        },
        onDelete: async (id) => {
          const product = products.find((p) => p.id === id);
          if (!window.confirm(`Delete "${product?.name}"? This cannot be undone.`)) return;
          try {
            await adminDeleteProduct(id);
            products = products.filter((p) => p.id !== id);
            refreshTable();
          } catch (err) {
            console.error('Delete failed', err);
            statusEl.textContent = 'Could not delete that product. Please try again.';
          }
        },
        onQuickAction: async (id, patch) => {
          try {
            const updated = await adminUpdateProduct(id, patch);
            products = products.map((p) => (p.id === id ? updated : p));
            refreshTable();
          } catch (err) {
            console.error('Update failed', err);
            statusEl.textContent = 'Could not save that change. Please try again.';
          }
        },
        onMessage: (text) => {
          statusEl.textContent = text;
        },
        shippingRates,
      })
    );
  }

  function showForm(product) {
    mount.innerHTML = `
      <h1>${product ? 'Edit Product' : 'Add Product'}</h1>
      <div id="form-mount"></div>
    `;
    const formMount = mount.querySelector('#form-mount');
    formMount.appendChild(
      createProductForm({
        categories,
        product,
        shippingRates,
        onCancel: () => renderSection('products'),
        onDone: () => renderSection('products'),
        onSubmit: async (fields) => {
          if (product) {
            return adminUpdateProduct(product.id, fields);
          }
          return adminCreateProduct(fields);
        },
      })
    );
  }

  mount.querySelector('#add-product-btn').addEventListener('click', () => showForm());
  refreshTable();
}

async function renderShippingSection(mount) {
  mount.innerHTML = '<h1>Shipping Settings</h1><div id="shipping-form-mount"></div>';
  const formMount = mount.querySelector('#shipping-form-mount');
  const classes = await adminListShippingClasses();
  formMount.appendChild(
    createShippingForm({
      classes,
      onBack: () => renderSection('products'),
      onSave: async (rates) => {
        await Promise.all(Object.entries(rates).map(([key, cents]) => adminUpdateShippingRate(key, cents)));
      },
    })
  );
}

async function renderCategoriesSection(mount) {
  mount.innerHTML = '<h1>Categories</h1><p class="admin-notice">Order here also controls the category filter order on /shop.</p><div id="category-mount"></div>';
  const categories = await adminListCategoriesWithCounts();
  mount.querySelector('#category-mount').appendChild(
    createCategoryManager(categories, {
      onCreate: (fields) => adminCreateCategory(fields),
      onRename: (id, fields) => adminUpdateCategory(id, fields),
      onReorder: (orderedIds) => adminReorderCategories(orderedIds),
      onDelete: (id) => adminDeleteCategory(id),
    })
  );
}

async function renderOrdersSection(mount) {
  mount.innerHTML = '<h1>Orders</h1><div id="orders-mount"></div>';
  const ordersMount = mount.querySelector('#orders-mount');
  const orders = await adminListOrders();

  function showList() {
    ordersMount.replaceChildren(createOrdersTable(orders, { onSelect: (id) => showDetail(id) }));
  }
  function showDetail(id) {
    const order = orders.find((o) => o.id === id);
    ordersMount.replaceChildren(createOrderDetail(order, { onBack: showList }));
  }
  showList();
}

async function init() {
  if (!isSupabaseConfigured()) {
    renderNotConfigured();
    return;
  }

  root.innerHTML = '<div class="admin-panel"><p class="admin-notice">Loading&hellip;</p></div>';

  const session = await getSession();
  if (!session) {
    renderLogin();
    return;
  }

  const isAdmin = await checkIsAdmin();
  if (!isAdmin) {
    renderUnauthorized();
    return;
  }

  renderShell('products');
}

init();
