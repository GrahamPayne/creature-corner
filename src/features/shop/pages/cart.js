import { getProductsByIds, getShippingClasses } from '../api/products.js';
import { readCart, removeFromCart, updateCartQuantity } from '../cart/cart.js';
import { syncNavBadge } from '../cart/navBadge.js';
import { determineFulfillmentOptions } from '../cart/shippingRules.js';
import { computeSubtotalCents, computeShippingCents, computeTotalCents } from '../cart/cartTotals.js';
import { pickPrimaryImage } from '../primaryImage.js';
import { formatCents } from '../money.js';
import { escapeHtml } from '../dom.js';

const mount = document.getElementById('cart-mount');

const SHIPPING_LABELS = {
  small: 'Small parcel',
  medium: 'Medium parcel',
  large: 'Large parcel',
  oversized: 'Oversized / freight',
};

/** @type {{fulfillment: 'shipping'|'pickup'|null, address: Record<string,string>}} */
const formState = {
  fulfillment: null,
  address: { fullName: '', email: '', line1: '', line2: '', city: '', state: '', zip: '', phone: '' },
};

/** Builds one row per cart entry, matched against freshly-fetched product data. Never trusts anything from localStorage except the id/quantity pair itself. */
function buildLineItems(entries, products) {
  return entries.map((entry) => {
    const product = products.find((p) => p.id === entry.productId);
    if (!product) {
      return { entry, product: null, available: false, reason: 'gone' };
    }
    const soldOut = product.status === 'sold' || product.quantity <= 0;
    if (soldOut) {
      return { entry, product, available: false, reason: 'sold' };
    }
    const adjusted = entry.quantity > product.quantity;
    const quantity = adjusted ? product.quantity : entry.quantity;
    return { entry, product, available: true, reason: null, quantity, adjusted };
  });
}

function renderEmpty() {
  mount.innerHTML = `
    <p class="shop-empty">Your cart is empty.</p>
    <p><a href="/shop" class="btn btn-secondary">Browse the Shop</a></p>
  `;
}

function renderUnavailableRow(line) {
  const name = line.product ? escapeHtml(line.product.name) : 'This item';
  const message =
    line.reason === 'sold' ? `${name} has sold and is no longer available.` : `${name} is no longer available. It may have been removed.`;
  return `
    <div class="cart-item cart-item-unavailable">
      <p class="cart-unavailable-message">${message}</p>
      <button type="button" class="cart-btn-sm" data-remove="${line.entry.productId}">Remove from cart</button>
    </div>
  `;
}

function renderAvailableRow(line) {
  const { product, quantity } = line;
  const primary = pickPrimaryImage(product.images);
  const lineTotal = product.priceCents * quantity;
  return `
    <div class="cart-item">
      <div class="cart-item-image${primary ? '' : ' placeholder'}">
        ${primary ? `<img src="${escapeHtml(primary.url)}" alt="${escapeHtml(product.name)}">` : '<span>No Image</span>'}
      </div>
      <div class="cart-item-info">
        <a href="/product/${product.slug}" class="cart-item-name">${escapeHtml(product.name)}</a>
        <div class="cart-item-price">${formatCents(product.priceCents)} each</div>
        ${line.adjusted ? `<p class="cart-adjusted-note">Only ${product.quantity} remain. Your quantity was adjusted.</p>` : ''}
        <div class="cart-qty-controls">
          <button type="button" class="cart-btn-sm" data-qty-down="${product.id}" ${quantity <= 1 ? 'disabled' : ''}>−</button>
          <span class="cart-qty-value">${quantity}</span>
          <button type="button" class="cart-btn-sm" data-qty-up="${product.id}" ${quantity >= product.quantity ? 'disabled' : ''}>+</button>
          <button type="button" class="cart-btn-sm cart-btn-danger" data-remove="${product.id}">Remove</button>
        </div>
      </div>
      <div class="cart-item-total">${formatCents(lineTotal)}</div>
    </div>
  `;
}

function render(entries, products, shippingClasses) {
  const lines = buildLineItems(entries, products);

  if (lines.length === 0) {
    renderEmpty();
    return;
  }

  // Persist any stock-driven quantity clamp so the stale, too-high number
  // doesn't linger in localStorage and re-trigger the same notice forever.
  for (const l of lines) {
    if (l.available && l.adjusted) updateCartQuantity(l.product.id, l.quantity, l.product.quantity);
  }

  const availableLines = lines.filter((l) => l.available);
  const fulfillmentInput = availableLines.map((l) => ({ shippingClass: l.product.shippingClass, pickupAvailable: l.product.pickupAvailable }));
  const { shippingAvailable, pickupAvailable, conflict } = determineFulfillmentOptions(fulfillmentInput);

  // Auto-pick the only available option; keep an existing valid choice; otherwise default to shipping.
  if (conflict) {
    formState.fulfillment = null;
  } else if (shippingAvailable && !pickupAvailable) {
    formState.fulfillment = 'shipping';
  } else if (pickupAvailable && !shippingAvailable) {
    formState.fulfillment = 'pickup';
  } else if (!formState.fulfillment) {
    formState.fulfillment = shippingAvailable ? 'shipping' : 'pickup';
  }

  const rateByClass = Object.fromEntries(shippingClasses.map((c) => [c.key, c.flatPriceCents]));
  const subtotalCents = computeSubtotalCents(availableLines.map((l) => ({ priceCents: l.product.priceCents, quantity: l.quantity })));
  const shipping = conflict || availableLines.length === 0
    ? { cents: null, configured: false, shippingClass: null }
    : computeShippingCents(fulfillmentInput, formState.fulfillment, rateByClass);
  const totalCents = computeTotalCents(subtotalCents, shipping.cents);

  const canContinue =
    availableLines.length > 0 &&
    !conflict &&
    formState.fulfillment &&
    shipping.configured &&
    (formState.fulfillment === 'pickup' ? addressValid('pickup') : addressValid('shipping'));

  mount.innerHTML = `
    <div class="cart-items">
      ${lines.map((l) => (l.available ? renderAvailableRow(l) : renderUnavailableRow(l))).join('')}
    </div>

    ${conflict ? `
      <p class="cart-notice cart-notice-error cart-conflict">
        Your cart has items that can't be fulfilled together — one item can only be shipped, another can only be
        picked up locally. Please remove one before continuing.
      </p>
    ` : availableLines.length === 0 ? '' : `
      <section class="cart-fulfillment">
        <h2 class="cart-section-title">Fulfillment</h2>
        ${shippingAvailable && pickupAvailable ? `
          <label class="cart-radio-label">
            <input type="radio" name="fulfillment" value="shipping" ${formState.fulfillment === 'shipping' ? 'checked' : ''}> Shipping
          </label>
          <label class="cart-radio-label">
            <input type="radio" name="fulfillment" value="pickup" ${formState.fulfillment === 'pickup' ? 'checked' : ''}> Local Pickup
          </label>
        ` : shippingAvailable ? `<p class="cart-notice">Shipping only — this order doesn't qualify for local pickup.</p>`
          : `<p class="cart-notice">Local pickup only — this item can't be shipped.</p>`}

        ${formState.fulfillment === 'shipping' ? renderShippingAddressForm() : formState.fulfillment === 'pickup' ? renderPickupForm() : ''}
      </section>

      <section class="cart-summary">
        <div class="cart-summary-row"><span>Subtotal</span><span>${formatCents(subtotalCents)}</span></div>
        <div class="cart-summary-row">
          <span>${formState.fulfillment === 'pickup' ? 'Local Pickup' : 'Shipping'}</span>
          <span>${shipping.configured ? formatCents(shipping.cents) : 'Not yet configured'}</span>
        </div>
        ${shipping.shippingClass ? `<p class="cart-shipping-note">Based on the largest item in your cart: ${SHIPPING_LABELS[shipping.shippingClass] || shipping.shippingClass}.</p>` : ''}
        <div class="cart-summary-row cart-summary-total"><span>Total</span><span>${totalCents === null ? '—' : formatCents(totalCents)}</span></div>
        ${!shipping.configured ? '<p class="cart-notice cart-notice-error">Shipping rates haven’t been set yet — checkout can’t continue until they are.</p>' : ''}

        <button type="button" class="btn btn-primary cart-continue-btn" id="continue-to-payment-btn" ${canContinue ? '' : 'disabled'}>
          Continue to Payment
        </button>
        <p id="payment-placeholder-msg" class="product-note" hidden>
          Payments are not enabled yet. Checkout will be completed in a future update — nothing has been charged.
        </p>
      </section>
    `}
  `;

  wireEvents(entries, products, shippingClasses);
}

function renderShippingAddressForm() {
  const a = formState.address;
  return `
    <div class="cart-address-form">
      <p class="cart-notice">Shipping within the United States only for now.</p>
      <label>Full name <input type="text" data-field="fullName" value="${escapeHtml(a.fullName)}" required></label>
      <label>Email <input type="email" data-field="email" value="${escapeHtml(a.email)}" required></label>
      <label>Address line 1 <input type="text" data-field="line1" value="${escapeHtml(a.line1)}" required></label>
      <label>Address line 2 (optional) <input type="text" data-field="line2" value="${escapeHtml(a.line2)}"></label>
      <label>City <input type="text" data-field="city" value="${escapeHtml(a.city)}" required></label>
      <label>State <input type="text" data-field="state" value="${escapeHtml(a.state)}" required maxlength="2" placeholder="CA"></label>
      <label>ZIP <input type="text" data-field="zip" value="${escapeHtml(a.zip)}" required></label>
      <label>Country <input type="text" value="United States" disabled></label>
    </div>
  `;
}

function renderPickupForm() {
  const a = formState.address;
  return `
    <div class="cart-address-form">
      <label>Full name <input type="text" data-field="fullName" value="${escapeHtml(a.fullName)}" required></label>
      <label>Email <input type="email" data-field="email" value="${escapeHtml(a.email)}" required></label>
      <label>Phone (optional) <input type="tel" data-field="phone" value="${escapeHtml(a.phone)}"></label>
    </div>
  `;
}

function addressValid(fulfillment) {
  const a = formState.address;
  if (fulfillment === 'pickup') return Boolean(a.fullName.trim() && a.email.trim());
  return Boolean(a.fullName.trim() && a.email.trim() && a.line1.trim() && a.city.trim() && a.state.trim() && a.zip.trim());
}

function wireEvents(entries, products, shippingClasses) {
  mount.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-remove');
      const updated = removeFromCart(id);
      syncNavBadge();
      render(updated, products, shippingClasses);
    });
  });

  mount.querySelectorAll('[data-qty-up]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-qty-up');
      const product = products.find((p) => p.id === id);
      const current = entries.find((e) => e.productId === id);
      const updated = updateCartQuantity(id, (current?.quantity ?? 1) + 1, product?.quantity);
      syncNavBadge();
      render(updated, products, shippingClasses);
    });
  });

  mount.querySelectorAll('[data-qty-down]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-qty-down');
      const product = products.find((p) => p.id === id);
      const current = entries.find((e) => e.productId === id);
      const updated = updateCartQuantity(id, (current?.quantity ?? 1) - 1, product?.quantity);
      syncNavBadge();
      render(updated, products, shippingClasses);
    });
  });

  mount.querySelectorAll('input[name="fulfillment"]').forEach((input) => {
    input.addEventListener('change', () => {
      formState.fulfillment = /** @type {'shipping'|'pickup'} */ (/** @type {HTMLInputElement} */ (input).value);
      render(entries, products, shippingClasses);
    });
  });

  mount.querySelectorAll('[data-field]').forEach((input) => {
    input.addEventListener('input', () => {
      const field = input.getAttribute('data-field');
      formState.address[field] = /** @type {HTMLInputElement} */ (input).value;
      // Re-render only the continue button's enabled state, not the whole
      // form, so typing doesn't steal focus from the field being edited.
      const btn = document.getElementById('continue-to-payment-btn');
      if (btn) btn.toggleAttribute('disabled', !addressValid(formState.fulfillment));
    });
  });

  const continueBtn = document.getElementById('continue-to-payment-btn');
  continueBtn?.addEventListener('click', () => {
    // Stage 7 note: this is a placeholder only. The eventual payment
    // server must NEVER trust the browser's subtotal, item prices,
    // shipping amount, or inventory counts — it has to re-fetch every
    // product from Supabase, re-check status/quantity, and recompute the
    // shipping class and total itself before creating a Stripe Checkout
    // Session. Nothing here is authoritative; it's UI only.
    continueBtn.setAttribute('disabled', '');
    const msg = document.getElementById('payment-placeholder-msg');
    if (msg) msg.hidden = false;
  });
}

async function init() {
  const entries = readCart();
  syncNavBadge();

  if (entries.length === 0) {
    renderEmpty();
    return;
  }

  mount.innerHTML = '<p class="cart-notice">Loading your cart&hellip;</p>';

  try {
    const [products, shippingClasses] = await Promise.all([
      getProductsByIds(entries.map((e) => e.productId)),
      getShippingClasses(),
    ]);
    render(entries, products, shippingClasses);
  } catch (err) {
    console.error('Failed to load cart', err);
    mount.innerHTML = '<p class="data-placeholder">Something went wrong loading your cart. Please try again later.</p>';
  }
}

init();
