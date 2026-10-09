# Orders admin & packing slip (Stage 6.5 structure notes)

## Orders admin section

`/admin` → Orders lists rows from the existing `orders`/`order_items`
tables (see `supabase/schema.sql`) via `admin/api.js`'s `adminListOrders`.
No fake orders are ever generated — the section shows "No orders yet."
until Stage 7 adds real checkout.

Filters (All / Needs Fulfillment / Shipping / Local Pickup / Fulfilled /
Cancelled / Refunded) are computed client-side in `admin/ordersTable.js`'s
`orderMatchesFilter`, entirely from the existing `status` and
`fulfillment_type` columns — "Needs Fulfillment" is `status === 'paid'`
(`admin/api.js`'s `deriveNeedsFulfillment`), not a stored value. This was
a deliberate choice over adding a `needs_fulfillment` column: the existing
status enum (`pending | paid | fulfilled | cancelled | refunded`) already
distinguishes "paid, not yet fulfilled" from every other state, so a new
column would just be a cache of information the table already has.

`admin/orderDetail.js` renders the full detail layout (Customer /
Fulfillment / Shipping Address / Items / Totals / Status) as a pure
function of an order object — the five future actions (Print Label, Print
Packing Slip, Mark Shipped, Mark Ready for Pickup, Mark Fulfilled) render
as disabled buttons. No label purchasing or payment-status logic exists
yet.

## Future packing slip (not built yet)

Documented here rather than implemented — there's no real order to
render one against yet, and a print view is easy to get subtly wrong
(margins, what's included) without one to check against live. Content,
when built:

```
Creature Corner
Order #<order id>
<customer name>
<shipping address>
----
<qty> x <item name>
<qty> x <item name>
```

Must **never** include: card/payment details, Stripe identifiers, or any
other sensitive payment data — only what's needed to pack and ship the
order. When built, this should be a pure render function (HTML or plain
text) taking the same order shape `adminListOrders`/`orderDetail.js`
already use, so it drops in without new data plumbing.
