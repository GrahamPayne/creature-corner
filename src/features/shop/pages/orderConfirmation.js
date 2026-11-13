import { clearCart } from '../cart/cart.js';
import { syncNavBadge } from '../cart/navBadge.js';
import { formatCents } from '../money.js';
import { escapeHtml } from '../dom.js';

const mount = document.getElementById('order-confirmation-mount');

// Stripe redirects here immediately after the customer approves payment on
// Stripe's hosted page — that redirect alone is NEVER treated as proof of
// payment (Payment Security / section H). This page only ever reports
// whatever functions/api/orders/status.js says the database actually
// has, which in turn only ever changes once the signature-verified
// webhook (functions/api/webhooks/stripe.js) has processed the real
// event. A closed browser tab doesn't block that — the order still gets
// confirmed server-side; this page is just a courtesy status display.
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 6;

function sessionIdFromUrl() {
  return new URLSearchParams(location.search).get('session_id');
}

function renderMissingSession() {
  mount.innerHTML = `
    <p class="data-placeholder">No order reference was found. If you just completed checkout, check your email, or return to the <a href="/cart">cart</a>.</p>
  `;
}

function renderNotFound() {
  mount.innerHTML = `
    <p class="data-placeholder">We couldn't find this order yet. If you just completed checkout, this can take a few seconds — try refreshing, or return to the <a href="/shop">shop</a>.</p>
  `;
}

function renderError() {
  mount.innerHTML = '<p class="data-placeholder">Something went wrong loading your order. Please try again later.</p>';
}

function renderOrder(order, { stillPending }) {
  const itemsHtml = (order.items || [])
    .map(
      (item) => `
        <div class="cart-item">
          <div class="cart-item-image${item.imageUrl ? '' : ' placeholder'}">
            ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}">` : '<span>No Image</span>'}
          </div>
          <div class="cart-item-info">
            <span class="cart-item-name">${escapeHtml(item.name)}</span>
            <div class="cart-item-price">${formatCents(item.unitPriceCents)} &times; ${item.quantity}</div>
          </div>
          <div class="cart-item-total">${formatCents(item.unitPriceCents * item.quantity)}</div>
        </div>
      `
    )
    .join('');

  mount.innerHTML = `
    <div class="specimen-entry">
      ${stillPending
        ? `<p class="cart-notice" id="confirmation-status">Confirming your payment&hellip; this usually only takes a few seconds.</p>`
        : order.paymentStatus === 'paid'
          ? `<p class="cart-notice">Thank you — your order is confirmed.</p>`
          : order.paymentStatus === 'pending'
            ? `<p class="cart-notice">Your payment is taking a bit longer than usual to confirm. This page stopped checking automatically, but nothing has failed — refresh in a moment, or check your email once it's confirmed.</p>`
            : `<p class="cart-notice cart-notice-error">This order's payment did not complete (status: ${escapeHtml(order.paymentStatus)}). No charge was completed. You can return to the <a href="/cart">cart</a> to try again.</p>`}

      <h2 class="cart-section-title">${escapeHtml(order.orderNumber)}</h2>

      <div class="cart-items">${itemsHtml}</div>

      <section class="cart-summary">
        <div class="cart-summary-row cart-summary-total"><span>Total</span><span>${formatCents(order.totalCents)}</span></div>
      </section>

      <p><a href="/shop" class="btn btn-secondary">Continue Browsing</a></p>
    </div>
  `;
}

async function fetchStatus(sessionId) {
  const res = await fetch(`/api/orders/status?session_id=${encodeURIComponent(sessionId)}`);
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error('status endpoint error');
  return { order: await res.json() };
}

async function init() {
  syncNavBadge();
  const sessionId = sessionIdFromUrl();
  if (!sessionId) {
    renderMissingSession();
    return;
  }

  mount.innerHTML = '<p class="cart-notice">Checking your order&hellip;</p>';

  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    let result;
    try {
      result = await fetchStatus(sessionId);
    } catch (err) {
      console.error('Failed to load order status', err);
      renderError();
      return;
    }

    if (result.notFound) {
      if (attempt === MAX_POLLS - 1) {
        renderNotFound();
        return;
      }
    } else {
      const stillPending = result.order.paymentStatus === 'pending' && attempt < MAX_POLLS - 1;
      renderOrder(result.order, { stillPending });
      if (result.order.paymentStatus === 'paid') {
        // The purchased items are now sold/reserved server-side — clear the
        // local cart so they don't linger as if still waiting to be bought.
        clearCart();
        syncNavBadge();
        return;
      }
      if (!stillPending) return; // terminal non-pending status (failed/cancelled/etc.) or exhausted polling
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

init();
