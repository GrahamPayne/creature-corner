-- Creature Corner shop — Orders & Fulfillment Infrastructure migration
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New
-- query), AFTER supabase/schema.sql and the prior migrations have already
-- been applied. Safe to re-run: every statement is additive and guarded
-- with IF NOT EXISTS / OR REPLACE where Postgres allows it. Nothing here
-- rewrites, drops, or deletes existing data — the existing `orders.status`
-- enum, `stripe_session_id`/`stripe_payment_intent_id` columns, and every
-- existing row are left exactly as they are.
--
-- Purpose: separate payment/fulfillment/shipping status (today they're
-- conflated into one `status` enum), add a provider-agnostic payment
-- reference, add atomic inventory reservations so a one-of-a-kind item
-- can't be oversold by two concurrent checkouts, and add an audit trail
-- (order_events) plus an idempotent webhook ledger (payment_events) for
-- future Stripe/PayPal/shipping-label integrations. See
-- docs/ORDERS_FULFILLMENT_ARCHITECTURE.md for the full design rationale.

-- ============================================================
-- ORDERS — new columns
-- status stays as-is (nothing reads it differently); payment_status/
-- fulfillment_status/shipping_status are the new, separate source of
-- truth going forward. Backfilled below from the existing `status` value
-- for any pre-existing rows so nothing silently becomes NULL/unknown.
-- ============================================================
alter table orders add column if not exists order_number text;
alter table orders add column if not exists currency text not null default 'usd';
alter table orders add column if not exists billing_address jsonb;
alter table orders add column if not exists tax_cents integer not null default 0;
alter table orders add column if not exists discount_cents integer not null default 0;

-- Provider-agnostic payment reference — NOT Stripe-specific (stripe_session_id/
-- stripe_payment_intent_id above are left in place for backward compatibility,
-- but new code should read/write payment_provider + payment_reference so a
-- PayPal or Square order isn't forced through Stripe-shaped columns).
alter table orders add column if not exists payment_provider text;
alter table orders add column if not exists payment_reference text;

alter table orders add column if not exists payment_status text not null default 'pending';
alter table orders add column if not exists fulfillment_status text not null default 'unfulfilled';
alter table orders add column if not exists shipping_status text not null default 'label_not_purchased';

alter table orders add column if not exists shipping_carrier text;
alter table orders add column if not exists shipping_service text;
alter table orders add column if not exists tracking_number text;
alter table orders add column if not exists label_reference text;
alter table orders add column if not exists notes text;

-- Lets a checkout retry (network hiccup, provider retry) safely re-POST
-- the same create-order request without creating a duplicate order.
alter table orders add column if not exists idempotency_key text;

-- Safe Test Mode (section J): unmistakably marks admin-created test orders
-- so they can never be confused with a real paid order.
alter table orders add column if not exists test_mode boolean not null default false;

-- Cumulative total actually refunded so far, across any number of partial
-- refunds — without this, each refund call would only be checkable against
-- the original total_cents, not against what's already been refunded, and
-- repeated partial refunds could together exceed the order total.
alter table orders add column if not exists refunded_amount_cents integer not null default 0;

do $$ begin
    alter table orders add constraint orders_refunded_amount_cents_check check (refunded_amount_cents >= 0);
exception when duplicate_object then null; end $$;

alter table orders add column if not exists paid_at timestamptz;
alter table orders add column if not exists fulfilled_at timestamptz;
alter table orders add column if not exists cancelled_at timestamptz;
alter table orders add column if not exists refunded_at timestamptz;

do $$ begin
    alter table orders add constraint orders_tax_cents_check check (tax_cents >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
    alter table orders add constraint orders_discount_cents_check check (discount_cents >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
    alter table orders add constraint orders_payment_status_check
        check (payment_status in ('pending', 'paid', 'failed', 'cancelled', 'partially_refunded', 'refunded'));
exception when duplicate_object then null; end $$;

do $$ begin
    alter table orders add constraint orders_fulfillment_status_check
        check (fulfillment_status in ('unfulfilled', 'preparing', 'fulfilled', 'cancelled'));
exception when duplicate_object then null; end $$;

do $$ begin
    alter table orders add constraint orders_shipping_status_check
        check (shipping_status in ('label_not_purchased', 'label_created', 'shipped', 'in_transit', 'delivered', 'exception'));
exception when duplicate_object then null; end $$;

-- order_number/idempotency_key are unique once populated, but existing (and
-- future draft-like) rows may legitimately have neither — partial unique
-- indexes so multiple NULLs are allowed while any real value must be unique.
create unique index if not exists orders_order_number_key on orders(order_number) where order_number is not null;
create unique index if not exists orders_idempotency_key_key on orders(idempotency_key) where idempotency_key is not null;

create index if not exists orders_payment_status_idx on orders(payment_status);
create index if not exists orders_fulfillment_status_idx on orders(fulfillment_status);

-- Backfill: map the existing single `status` enum onto the new separate
-- columns for any order created before this migration. A no-op today
-- (orders is empty in production — Stage 7 checkout was never wired up),
-- but correct regardless of when this actually runs.
update orders set
    payment_status = case status
        when 'pending' then 'pending'
        when 'paid' then 'paid'
        when 'fulfilled' then 'paid'
        when 'cancelled' then 'cancelled'
        when 'refunded' then 'refunded'
        else payment_status
    end,
    fulfillment_status = case status
        when 'fulfilled' then 'fulfilled'
        when 'cancelled' then 'cancelled'
        else fulfillment_status
    end
where payment_status = 'pending' and fulfillment_status = 'unfulfilled'; -- only touch rows still at the column defaults

-- ============================================================
-- ORDER_ITEMS — purchase-time product snapshot
-- product_name/unit_price_cents already exist and already are the
-- snapshot (Stage 6) — this adds the remaining fields needed to render a
-- clickable, illustrated line item without re-joining a product that may
-- have since been edited, re-categorized, or deleted.
-- ============================================================
alter table order_items add column if not exists product_slug text;
alter table order_items add column if not exists product_image_url text;

-- ============================================================
-- INVENTORY RESERVATIONS
-- The atomic overselling guard (section D). Reserving never touches
-- products.quantity — only a *confirmed* reservation (after verified
-- payment) does, via confirm_reservation() below. Availability for a
-- product is therefore: quantity - sum(active reservations' quantity).
-- ============================================================
create table if not exists inventory_reservations (
    id uuid primary key default gen_random_uuid(),
    product_id uuid not null references products(id) on delete cascade,
    order_id uuid references orders(id) on delete set null,
    quantity integer not null check (quantity > 0),
    status text not null default 'reserved' check (status in ('reserved', 'confirmed', 'released', 'expired')),
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists inventory_reservations_product_status_idx
    on inventory_reservations(product_id, status);
create index if not exists inventory_reservations_order_idx on inventory_reservations(order_id);
create index if not exists inventory_reservations_expiry_idx
    on inventory_reservations(expires_at) where status = 'reserved';

drop trigger if exists inventory_reservations_set_updated_at on inventory_reservations;
create trigger inventory_reservations_set_updated_at
    before update on inventory_reservations
    for each row
    execute function set_updated_at();

alter table inventory_reservations enable row level security;

create policy "only admins manage inventory reservations"
    on inventory_reservations for all
    to authenticated
    using (is_admin())
    with check (is_admin());

-- ============================================================
-- ORDER EVENTS — append-only audit trail (section C: "transaction
-- auditability"). Every lifecycle change (created, payment event,
-- fulfillment update, tracking added, cancellation, refund) is recorded
-- here, in addition to updating the order row itself, so the full history
-- survives even after the current state changes again.
-- ============================================================
create table if not exists order_events (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references orders(id) on delete cascade,
    event_type text not null,
    payload jsonb,
    created_by text,
    created_at timestamptz not null default now()
);

create index if not exists order_events_order_id_idx on order_events(order_id, created_at);

alter table order_events enable row level security;

create policy "only admins manage order events"
    on order_events for all
    to authenticated
    using (is_admin())
    with check (is_admin());

-- ============================================================
-- PAYMENT EVENTS — idempotent webhook/provider-event ledger (section C).
-- unique(provider, provider_event_id) is the actual idempotency guarantee:
-- a provider retrying the same webhook delivery (or two different
-- delivery attempts of the same event) can never be processed twice —
-- the second insert simply fails the unique constraint, which the future
-- webhook handler treats as "already processed, no-op" rather than an error.
-- ============================================================
create table if not exists payment_events (
    id uuid primary key default gen_random_uuid(),
    provider text not null,
    provider_event_id text not null,
    order_id uuid references orders(id) on delete set null,
    event_type text not null,
    payload jsonb,
    processed_at timestamptz,
    created_at timestamptz not null default now(),
    unique (provider, provider_event_id)
);

create index if not exists payment_events_order_id_idx on payment_events(order_id);

alter table payment_events enable row level security;

create policy "only admins manage payment events"
    on payment_events for all
    to authenticated
    using (is_admin())
    with check (is_admin());

-- ============================================================
-- ORDERS/ORDER_ITEMS — admin write access
-- Previously SELECT-only for authenticated admins (orders were only ever
-- written by a service-role checkout/webhook function that doesn't exist
-- yet). The new Admin Orders dashboard needs admins to create test orders
-- and update fulfillment/tracking/notes directly from the browser, the
-- same is_admin()-gated pattern every other admin-managed table
-- (products, categories, gallery_*) already uses. A future service-role
-- checkout/webhook function bypasses RLS entirely regardless, so this
-- doesn't change anything about how real customer orders get created.
-- ============================================================
drop policy if exists "only admins read orders" on orders;
create policy "only admins manage orders"
    on orders for all
    to authenticated
    using (is_admin())
    with check (is_admin());

drop policy if exists "only admins read order items" on order_items;
create policy "only admins manage order items"
    on order_items for all
    to authenticated
    using (is_admin())
    with check (is_admin());

grant select, insert, update, delete on orders, order_items, inventory_reservations, order_events, payment_events to authenticated;

-- ============================================================
-- reserve_inventory() — the atomic overselling guard.
--
-- `select ... for update` on the product row serializes concurrent
-- reservation attempts for the SAME product: two simultaneous requests for
-- the last unit of a quantity-1 piece cannot both succeed — the second
-- transaction blocks until the first commits, then re-reads the now-
-- current reservation total and correctly sees no inventory left.
--
-- Expired reservations for this product are swept (marked 'expired')
-- before computing availability, so a reservation that was never
-- confirmed or released eventually frees itself up without needing a
-- separate cron job to run first (a scheduled sweep is still worth adding
-- later for reservations on products nobody reserves again soon, but
-- correctness doesn't depend on it).
-- ============================================================
create or replace function reserve_inventory(
    p_product_id uuid,
    p_quantity integer,
    p_order_id uuid,
    p_ttl_minutes integer default 15
)
returns inventory_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
    v_available integer;
    v_reservation inventory_reservations;
begin
    if auth.role() <> 'service_role' and not is_admin() then
        raise exception 'not authorized';
    end if;
    if p_quantity <= 0 then
        raise exception 'quantity must be positive';
    end if;

    update inventory_reservations
       set status = 'expired', updated_at = now()
     where product_id = p_product_id
       and status = 'reserved'
       and expires_at < now();

    select p.quantity - coalesce((
        select sum(r.quantity) from inventory_reservations r
         where r.product_id = p_product_id and r.status = 'reserved'
    ), 0)
      into v_available
      from products p
     where p.id = p_product_id
       for update;

    if v_available is null then
        raise exception 'product not found';
    end if;
    if v_available < p_quantity then
        raise exception 'insufficient_inventory';
    end if;

    insert into inventory_reservations (product_id, order_id, quantity, status, expires_at)
    values (p_product_id, p_order_id, p_quantity, 'reserved', now() + make_interval(mins => p_ttl_minutes))
    returning * into v_reservation;

    return v_reservation;
end;
$$;

-- ============================================================
-- confirm_reservation() — converts a reservation into a permanent
-- inventory deduction. Only called after verified payment. Idempotent:
-- calling it again on an already-confirmed (or released/expired)
-- reservation is a no-op, so a retried/duplicate payment-confirmed event
-- can never double-deduct stock.
--
-- Locks the product row (same `for update` pattern reserve_inventory()
-- uses) BEFORE touching anything, and holds it for both the quantity
-- decrement and the reservation's status flip to 'confirmed'. Without
-- this, a concurrent reserve_inventory() call for the same product could
-- observe the two changes out of order (quantity already lowered, but the
-- reservation still showing 'reserved') and double-subtract the same
-- unit from availability.
-- ============================================================
create or replace function confirm_reservation(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_res inventory_reservations;
begin
    if auth.role() <> 'service_role' and not is_admin() then
        raise exception 'not authorized';
    end if;

    select * into v_res from inventory_reservations where id = p_reservation_id for update;
    if v_res is null then
        raise exception 'reservation not found';
    end if;
    if v_res.status <> 'reserved' then
        return;
    end if;

    perform 1 from products where id = v_res.product_id for update;

    update products set quantity = greatest(quantity - v_res.quantity, 0) where id = v_res.product_id;
    update inventory_reservations set status = 'confirmed', updated_at = now() where id = p_reservation_id;
end;
$$;

-- ============================================================
-- release_reservation() — frees a reservation without touching
-- products.quantity (nothing was ever permanently deducted). Used for
-- cancellations and can also be called on an expired reservation.
-- Idempotent for the same reason as confirm_reservation().
-- ============================================================
create or replace function release_reservation(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_res inventory_reservations;
begin
    if auth.role() <> 'service_role' and not is_admin() then
        raise exception 'not authorized';
    end if;

    select * into v_res from inventory_reservations where id = p_reservation_id for update;
    if v_res is null then
        raise exception 'reservation not found';
    end if;
    if v_res.status not in ('reserved', 'expired') then
        return;
    end if;

    update inventory_reservations set status = 'released', updated_at = now() where id = p_reservation_id;
end;
$$;

-- ============================================================
-- release_expired_reservations() — bulk sweep, meant to be called on a
-- schedule (a Cloudflare Cron Trigger calling a Pages Function that
-- invokes this via RPC is the intended production mechanism — not yet
-- configured; reserve_inventory()'s own lazy per-product sweep keeps
-- correctness even before a cron job exists, this is a cleanup pass).
-- ============================================================
create or replace function release_expired_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count integer;
begin
    if auth.role() <> 'service_role' and not is_admin() then
        raise exception 'not authorized';
    end if;

    update inventory_reservations
       set status = 'expired', updated_at = now()
     where status = 'reserved' and expires_at < now();
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;

grant execute on function reserve_inventory(uuid, integer, uuid, integer) to authenticated;
grant execute on function confirm_reservation(uuid) to authenticated;
grant execute on function release_reservation(uuid) to authenticated;
grant execute on function release_expired_reservations() to authenticated;
