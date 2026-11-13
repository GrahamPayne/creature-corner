import { getProductsByIds, getShippingClasses } from '../api/products.js';
import { readCart, removeFromCart, updateCartQuantity } from '../cart/cart.js';
import { syncNavBadge } from '../cart/navBadge.js';
import { determineFulfillmentOptions } from '../cart/shippingRules.js';
import { computeSubtotalCents, computeTotalCents } from '../cart/cartTotals.js';
import { getShippingQuote } from '../shipping/shippingProvider.js';
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
    ? { cents: null, configured: false, shippingClass: null, manualQuote: false }
    : getShippingQuote({ items: fulfillmentInput, fulfillment: formState.fulfillment, rateByClass });
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
        ${shipping.shippingClass && !shipping.manualQuote ? `<p class="cart-shipping-note">Based on the largest item in your cart: ${SHIPPING_LABELS[shipping.shippingClass] || shipping.shippingClass}.</p>` : ''}
        <div class="cart-summary-row cart-summary-total"><span>Total</span><span>${totalCents === null ? '—' : formatCents(totalCents)}</span></div>
        ${shipping.manualQuote
          ? '<p class="cart-notice cart-notice-error">One or more items in your cart need a custom shipping quote — we’ll follow up with pricing before anything is charged.</p>'
          : !shipping.configured ? '<p class="cart-notice cart-notice-error">Shipping rates haven’t been set yet — checkout can’t continue until they are.</p>' : ''}

        <button type="button" class="btn btn-primary cart-continue-btn" id="continue-to-payment-btn" ${canContinue ? '' : 'disabled'}>
          Continue to Payment
        </button>
        <p id="checkout-error-msg" class="product-note cart-notice-error" hidden></p>
      </section>
    `}
  `;

  wireEvents(entries, products, shippingClasses, availableLines);
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

function wireEvents(entries, products, shippingClasses, availableLines) {
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

  const continueBtn = /** @type {HTMLButtonElement} */ (document.getElementById('continue-to-payment-btn'));
  continueBtn?.addEventListener('click', () => startCheckout(continueBtn, availableLines));
}

/**
 * POSTs to the real checkout endpoint and redirects to Stripe's hosted
 * page. Nothing here is authoritative — functions/api/orders/create.js
 * re-fetches every product, re-checks stock/status, and recomputes
 * shipping/totals itself before ever creating a Stripe session; this
 * function only collects what the customer typed and reports whatever
 * the server decides, including its errors.
 * @param {HTMLButtonElement} continueBtn
 * @param {any[]} availableLines
 */
async function startCheckout(continueBtn, availableLines) {
  const errorMsg = /** @type {HTMLElement} */ (document.getElementById('checkout-error-msg'));
  if (errorMsg) errorMsg.hidden = true;
  continueBtn.disabled = true;
  const originalLabel = continueBtn.textContent;
  continueBtn.textContent = 'Redirecting to secure checkout…';

  try {
    const res = await fetch('/api/orders/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: availableLines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        email: formState.address.email,
        customerName: formState.address.fullName,
        fulfillmentType: formState.fulfillment,
        shippingAddress: formState.fulfillment === 'shipping'
          ? { line1: formState.address.line1, line2: formState.address.line2, city: formState.address.city, state: formState.address.state, zip: formState.address.zip }
          : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.redirectUrl) {
      throw new Error(data?.error || 'Could not start checkout. Please try again.');
    }
    window.location.href = data.redirectUrl;
  } catch (err) {
    console.error('Checkout failed', err);
    continueBtn.disabled = false;
    continueBtn.textContent = originalLabel;
    if (errorMsg) {
      errorMsg.textContent = err instanceof Error ? err.message : 'Something went wrong starting checkout. Please try again.';
      errorMsg.hidden = false;
    }
  }
}

/**
 * Stripe's cancel_url brings the customer back here with ?checkout=cancelled
 * — the order it created stays 'pending' with its reservation intact until
 * Stripe's own checkout.session.expired webhook releases it (see
 * functions/api/webhooks/stripe.js); nothing here needs to undo anything,
 * this is purely a "your cart is still here, nothing was charged" notice.
 * The query param is stripped immediately so a refresh doesn't re-show it.
 */
function showCancelledNoticeIfPresent() {
  const url = new URL(location.href);
  if (url.searchParams.get('checkout') !== 'cancelled') return;
  url.searchParams.delete('checkout');
  history.replaceState(null, '', url);

  const notice = document.createElement('p');
  notice.className = 'cart-notice';
  notice.textContent = 'Checkout was cancelled — your cart is unchanged and nothing was charged.';
  mount.before(notice);
}

async function init() {
  const entries = readCart();
  syncNavBadge();
  showCancelledNoticeIfPresent();

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
