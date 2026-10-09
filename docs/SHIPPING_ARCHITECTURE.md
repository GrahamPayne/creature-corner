# Shipping architecture

Stage 6 shipped a flat-rate shipping system (see `docs/SHOP_SETUP.md`).
Stage 6.5 wraps it behind a provider abstraction so a future EasyPost
integration can replace it without touching the cart.

## The abstraction

`src/features/shop/shipping/shippingProvider.js` exports:

```js
getShippingQuote({ items, fulfillment, rateByClass })
// -> { cents: number|null, configured: boolean, shippingClass: string|null, manualQuote: boolean }
```

`src/features/shop/pages/cart.js` calls only this function — it has no
idea whether the quote came from a flat-rate lookup or a real carrier API.
Today, `getShippingQuote` delegates to the existing flat-rate logic
(`cart/shippingRules.js`'s `highestShippingClass` + `cart/cartTotals.js`'s
`computeShippingCents`), with one addition: any item whose
`shippingClass` is `special_quote` forces `{ configured: false,
manualQuote: true }` regardless of what else is in the cart, so that kind
of product can never receive an automatic/fake price.

## What EasyPost needs per product

`products` now carries (see `supabase/migrations/002_stage_6_5.sql`):

- `packed_weight_lb`, `packed_weight_oz` — final packed weight
- `package_length_in`, `package_width_in`, `package_height_in` — final
  packed box dimensions

These are the **packed shipping** numbers (entered by the admin in the
"PACKED SHIPPING INFO" section of Add/Edit Product), never the artwork's
own dimensions field.

## Where the real EasyPost call will live

EasyPost must be called **server-side only**, from a Cloudflare Pages
Function (a new file under `functions/api/`, not written yet) — never
from browser code, because it requires a secret API key. The reserved
(not yet set) environment variable name is `EASYPOST_API_KEY`; it would
be added as a Cloudflare Pages secret, never committed, never shipped to
the browser, exactly like `SUPABASE_SERVICE_ROLE_KEY` today.

The future function's contract:

**Input** (from the cart, forwarded by the browser to the Function):
- origin address (server-side config, not sent by the browser)
- destination address (from the cart's shipping address form)
- packed weight (lb/oz) and dimensions (L/W/H) per shippable line item

**Output:** a normalized list of shipping options (carrier, service
name, price, estimated delivery), which `getShippingQuote`'s future
EasyPost-backed implementation maps into the same
`{cents, configured, shippingClass, manualQuote}` shape the cart already
renders — or an equivalent "multiple options" shape if the cart UI is
extended later to let the customer pick a service level.

## EasyPost handoff checklist (for later)

1. Receive EasyPost Test API key.
2. Add `EASYPOST_API_KEY` as a Cloudflare server-side secret.
3. Add origin/ship-from address configuration server-side.
4. Build the server-side rate endpoint (`functions/api/shipping-rate.js` or
   similar).
5. Send destination + packed weight/dimensions to EasyPost.
6. Return normalized rates to the cart.
7. Replace the flat-rate path in `shippingProvider.js` with live rates for
   products that have complete packed-shipping data (fall back to flat
   rate for anything still missing it).
8. Verify test-mode rates end-to-end.
9. Only later switch to the Production key.

None of these steps are implemented yet — this stage only prepares the
seam they'll plug into.
