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
} from '../admin/api.js';
import { createProductForm } from '../admin/productForm.js';
import { createProductTable } from '../admin/productTable.js';
import { createShippingForm } from '../admin/shippingForm.js';
import { escapeHtml } from '../dom.js';

const root = document.getElementById('admin-root');

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
    renderDashboard();
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

function renderError(message) {
  root.innerHTML = `
    <div class="admin-panel">
      <h1>Admin</h1>
      <p class="admin-notice admin-notice-error">${escapeHtml(message)}</p>
    </div>
  `;
}

async function renderDashboard() {
  root.innerHTML = `
    <div class="admin-panel">
      <div class="admin-header">
        <h1>Products</h1>
        <div class="admin-header-actions">
          <button type="button" class="admin-btn admin-btn-primary" id="add-product-btn">Add Product</button>
          <button type="button" class="admin-btn" id="shipping-settings-btn">Shipping Settings</button>
          <button type="button" class="admin-btn" id="signout-btn">Sign Out</button>
        </div>
      </div>
      <p id="admin-status" class="admin-notice">Loading products&hellip;</p>
      <div id="admin-table-mount"></div>
    </div>
  `;

  document.getElementById('signout-btn').addEventListener('click', async () => {
    await signOut();
    renderLogin();
  });

  let categories;
  let products;
  try {
    [categories, products] = await Promise.all([adminListCategories(), adminListProducts()]);
  } catch (err) {
    console.error('Failed to load admin data', err);
    renderError('Could not load products right now. Please refresh and try again.');
    return;
  }

  const statusEl = document.getElementById('admin-status');
  const tableMount = document.getElementById('admin-table-mount');

  function refreshTable() {
    statusEl.textContent = `${products.length} product${products.length === 1 ? '' : 's'}`;
    tableMount.replaceChildren(
      createProductTable(products, {
        onEdit: (id) => showForm(categories, products.find((p) => p.id === id)),
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
      })
    );
  }

  function showForm(categories, product) {
    root.querySelector('.admin-panel').innerHTML = `
      <h1>${product ? 'Edit Product' : 'Add Product'}</h1>
      <div id="form-mount"></div>
    `;
    const formMount = document.getElementById('form-mount');
    formMount.appendChild(
      createProductForm({
        categories,
        product,
        onCancel: () => renderDashboard(),
        onDone: () => renderDashboard(),
        onSubmit: async (fields) => {
          if (product) {
            const updated = await adminUpdateProduct(product.id, fields);
            products = products.map((p) => (p.id === product.id ? updated : p));
            return updated;
          }
          const created = await adminCreateProduct(fields);
          products.unshift(created);
          return created;
        },
      })
    );
  }

  async function showShippingSettings() {
    root.querySelector('.admin-panel').innerHTML = `
      <h1>Shipping Settings</h1>
      <div id="shipping-form-mount"></div>
    `;
    const mount = document.getElementById('shipping-form-mount');
    let classes;
    try {
      classes = await adminListShippingClasses();
    } catch (err) {
      console.error('Failed to load shipping classes', err);
      mount.innerHTML = '<p class="admin-notice admin-notice-error">Could not load shipping settings. Please try again.</p>';
      return;
    }
    mount.appendChild(
      createShippingForm({
        classes,
        onBack: () => renderDashboard(),
        onSave: async (rates) => {
          await Promise.all(Object.entries(rates).map(([key, cents]) => adminUpdateShippingRate(key, cents)));
        },
      })
    );
  }

  document.getElementById('add-product-btn').addEventListener('click', () => showForm(categories));
  document.getElementById('shipping-settings-btn').addEventListener('click', () => showShippingSettings());

  refreshTable();
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

  renderDashboard();
}

init();
