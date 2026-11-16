-- Atomic Stripe application. Apply AFTER 005; do not re-run 005's policies.
-- No external calls occur in this transaction. Exceptions roll back the event
-- claim, stock, order and audit together; the HTTP handler returns 500 to retry.
begin;

-- A durable fulfillment gate, separate from carrier/shipping exceptions.
alter table orders add column if not exists inventory_conflict boolean not null default false;
create or replace function guard_inventory_conflict_fulfillment()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.inventory_conflict and (new.fulfillment_status in ('preparing', 'fulfilled') or new.status = 'fulfilled') then
    raise exception 'Resolve inventory conflict before fulfillment';
  end if;
  return new;
end;
$$;
drop trigger if exists orders_inventory_conflict_guard on orders;
create trigger orders_inventory_conflict_guard before insert or update on orders
  for each row execute function guard_inventory_conflict_fulfillment();

-- Lock the product in a separate statement BEFORE reading reservations. A
-- locking SELECT with an aggregate subquery can retain a pre-wait snapshot.
create or replace function reserve_inventory(p_product_id uuid, p_quantity integer, p_order_id uuid, p_ttl_minutes integer default 15)
returns inventory_reservations
language plpgsql security definer set search_path = public
as $$
declare
  v_stock integer;
  v_available bigint;
  v_reservation inventory_reservations;
begin
  if auth.role() is distinct from 'service_role' and not is_admin() then
    raise exception 'not authorized';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_ttl_minutes is null or p_ttl_minutes <= 0 then
    raise exception 'quantity and TTL must be positive';
  end if;
  -- All order-aware paths lock order -> product -> reservation.
  if p_order_id is not null then
    perform 1 from orders where id = p_order_id for update;
    if not found then raise exception 'order not found'; end if;
  end if;
  select quantity into v_stock from products where id = p_product_id for update;
  if not found then raise exception 'product not found'; end if;
  update inventory_reservations set status = 'expired', updated_at = now()
    where product_id = p_product_id and status = 'reserved' and expires_at <= now();
  select v_stock - coalesce(sum(quantity), 0) into v_available
    from inventory_reservations where product_id = p_product_id and status = 'reserved';
  if v_available < p_quantity then raise exception 'insufficient_inventory'; end if;
  insert into inventory_reservations(product_id, order_id, quantity, status, expires_at)
    values(p_product_id, p_order_id, p_quantity, 'reserved', now() + make_interval(mins => p_ttl_minutes))
    returning * into v_reservation;
  return v_reservation;
end;
$$;

-- Keep existing callers compatible, but use the same lock order as reserve
-- and webhook. Re-read the reservation after acquiring the product lock.
create or replace function confirm_reservation(p_reservation_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_res inventory_reservations; v_stock integer;
begin
  if auth.role() is distinct from 'service_role' and not is_admin() then raise exception 'not authorized'; end if;
  select * into v_res from inventory_reservations where id = p_reservation_id;
  if not found then raise exception 'reservation not found'; end if;
  if v_res.order_id is not null then perform 1 from orders where id = v_res.order_id for update; end if;
  select quantity into v_stock from products where id = v_res.product_id for update;
  select * into v_res from inventory_reservations where id = p_reservation_id for update;
  if v_res.status <> 'reserved' then return; end if;
  if v_stock < v_res.quantity then raise exception 'insufficient_inventory'; end if;
  update products set quantity = quantity - v_res.quantity where id = v_res.product_id;
  update inventory_reservations set status = 'confirmed', updated_at = now() where id = v_res.id;
end;
$$;

create or replace function process_stripe_event(p_event jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_event_id uuid;
  v_type text := p_event->>'type';
  v_object jsonb := p_event#>'{data,object}';
  v_order orders;
  v_item record;
  v_stock integer;
  v_confirmed bigint;
  v_other bigint;
  v_needed integer;
  v_refund integer;
  v_conflicts jsonb := '[]'::jsonb;
  v_result text := 'ignored';
  v_history text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not authorized'; end if;
  if coalesce(p_event->>'id', '') = '' or coalesce(v_type, '') = '' then raise exception 'malformed event'; end if;
  insert into payment_events(provider, provider_event_id, event_type, payload)
    values('stripe', p_event->>'id', v_type, p_event)
    on conflict (provider, provider_event_id) do nothing returning id into v_event_id;
  if v_event_id is null then return jsonb_build_object('result', 'already processed'); end if;

  if v_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded',
                'checkout.session.expired', 'checkout.session.async_payment_failed', 'charge.refunded') then
    if v_type = 'charge.refunded' then
      -- Refunds may arrive before the success webhook. Missing intent binding
      -- is retryable, never acknowledged as a permanently unmatched refund.
      select * into strict v_order from orders
        where stripe_payment_intent_id = v_object->>'payment_intent' for update;
      if nullif(v_object#>>'{metadata,order_id}', '') is not null
         and v_object#>>'{metadata,order_id}' <> v_order.id::text then raise exception 'order mismatch'; end if;
    else
      select * into strict v_order from orders where id = (v_object#>>'{metadata,order_id}')::uuid for update;
      if v_order.payment_reference is null or v_order.payment_reference is distinct from v_object->>'id' then
        raise exception 'session mismatch or not yet bound';
      end if;
      if v_object->>'mode' is distinct from 'payment' then raise exception 'session mode mismatch'; end if;
    end if;
    if v_order.payment_provider is distinct from 'stripe' or v_order.test_mode then raise exception 'order provider mismatch'; end if;
    -- create.js currently marks both sandbox and live Stripe orders test_mode=false.
    -- Bind mode to the persisted Checkout ID, not that admin-test flag.
    if jsonb_typeof(p_event->'livemode') is distinct from 'boolean'
       or (p_event->>'livemode')::boolean is distinct from (v_order.payment_reference like 'cs_live_%')
       or not (v_order.payment_reference like 'cs_live_%' or v_order.payment_reference like 'cs_test_%') then
      raise exception 'order mode mismatch';
    end if;
    update payment_events set order_id = v_order.id where id = v_event_id;

    if v_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') then
      if v_object->>'payment_status' = 'unpaid' and v_type = 'checkout.session.completed' then
        v_result := 'awaiting payment';
      else
        if v_object->>'payment_status' is distinct from 'paid' then raise exception 'payment is not paid'; end if;
        if (v_object->>'amount_total')::bigint is distinct from v_order.total_cents::bigint
           or v_object->>'currency' is distinct from v_order.currency then raise exception 'payment amount or currency mismatch'; end if;
        if coalesce(v_object->>'payment_intent', '') = '' then raise exception 'missing payment intent'; end if;
        if v_order.stripe_payment_intent_id is not null
           and v_order.stripe_payment_intent_id is distinct from v_object->>'payment_intent' then raise exception 'payment intent mismatch'; end if;
        if v_order.payment_status in ('paid', 'partially_refunded', 'refunded') then
          v_result := 'already paid or refunded';
        else
          if not exists(select 1 from order_items where order_id = v_order.id) then raise exception 'missing order items'; end if;
          -- Deterministic product order, then reservations. Compare against
          -- purchased quantities, never iterate expired reservation history.
          for v_item in select product_id, sum(quantity)::integer as quantity from order_items
              where order_id = v_order.id group by product_id order by product_id loop
            select quantity into v_stock from products where id = v_item.product_id for update;
            if not found then
              v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('productId', v_item.product_id, 'reason', 'product missing'));
              continue;
            end if;
            perform 1 from inventory_reservations where product_id = v_item.product_id order by id for update;
            select coalesce(sum(quantity), 0) into v_confirmed from inventory_reservations
              where order_id = v_order.id and product_id = v_item.product_id and status = 'confirmed';
            v_needed := greatest(v_item.quantity - v_confirmed, 0);
            select coalesce(sum(quantity), 0) into v_other from inventory_reservations
              where product_id = v_item.product_id and order_id is distinct from v_order.id
                and status = 'reserved' and expires_at > now();
            -- Retire this order's holds; confirmed units are preserved. A
            -- replacement is a direct confirmed deficit, never a fresh hold.
            update inventory_reservations set status = 'released', updated_at = now()
              where order_id = v_order.id and product_id = v_item.product_id and status = 'reserved';
            if v_stock - v_other < v_needed then
              v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('productId', v_item.product_id, 'quantity', v_needed, 'reason', 'insufficient_inventory'));
            elsif v_needed > 0 then
              update products set quantity = quantity - v_needed where id = v_item.product_id;
              insert into inventory_reservations(product_id, order_id, quantity, status, expires_at)
                values(v_item.product_id, v_order.id, v_needed, 'confirmed', now());
            end if;
          end loop;
          update orders set payment_status = 'paid', status = 'paid', paid_at = coalesce(paid_at, now()),
            stripe_payment_intent_id = v_object->>'payment_intent',
            inventory_conflict = jsonb_array_length(v_conflicts) > 0,
            shipping_status = case when jsonb_array_length(v_conflicts) > 0 then 'exception' else shipping_status end,
            fulfillment_status = case when jsonb_array_length(v_conflicts) > 0 then 'unfulfilled' else fulfillment_status end
            where id = v_order.id;
          v_history := case when jsonb_array_length(v_conflicts) > 0 then 'payment.inventory_conflict' else 'payment.paid' end;
          v_result := case when jsonb_array_length(v_conflicts) > 0 then 'paid with inventory conflict' else 'paid' end;
        end if;
      end if;
    elsif v_type = 'charge.refunded' then
      if v_object->>'currency' is distinct from v_order.currency
         or (v_object->>'amount')::bigint is distinct from v_order.total_cents::bigint then raise exception 'refund amount or currency mismatch'; end if;
      v_refund := (v_object->>'amount_refunded')::integer;
      if v_refund is null or v_refund < 0 or v_refund > v_order.total_cents then raise exception 'invalid refund'; end if;
      if v_refund > v_order.refunded_amount_cents and v_order.payment_status <> 'refunded' then
        update orders set refunded_amount_cents = v_refund,
          payment_status = case when v_refund = total_cents then 'refunded' else 'partially_refunded' end,
          status = case when v_refund = total_cents then 'refunded' else status end,
          refunded_at = case when v_refund = total_cents then coalesce(refunded_at, now()) else refunded_at end
          where id = v_order.id;
        v_history := 'payment.refunded'; v_result := 'refund recorded';
      else v_result := 'stale refund ignored'; end if;
    elsif v_order.payment_status = 'pending' then
      -- A terminal Checkout event is actionable; payment_intent.payment_failed
      -- alone is a retryable payment attempt and deliberately ignored below.
      perform 1 from products where id in (select product_id from inventory_reservations where order_id = v_order.id) order by id for update;
      update inventory_reservations set status = 'released', updated_at = now() where order_id = v_order.id and status = 'reserved';
      update orders set payment_status = case when v_type = 'checkout.session.expired' then 'cancelled' else 'failed' end,
        status = case when v_type = 'checkout.session.expired' then 'cancelled' else status end,
        cancelled_at = case when v_type = 'checkout.session.expired' then now() else cancelled_at end where id = v_order.id;
      v_history := case when v_type = 'checkout.session.expired' then 'checkout.expired' else 'payment.failed' end;
      v_result := 'reservations released';
    else v_result := 'terminal payment preserved'; end if;

    if v_history is not null then
      insert into order_events(order_id, event_type, payload, created_by)
        values(v_order.id, v_history, jsonb_build_object('providerEventId', p_event->>'id', 'reference', v_object->>'id', 'conflicts', v_conflicts, 'amountRefundedCents', v_refund), 'stripe-webhook');
    end if;
  end if;
  update payment_events set processed_at = now() where id = v_event_id;
  return jsonb_build_object('result', v_result);
end;
$$;

revoke all on function process_stripe_event(jsonb) from public, anon, authenticated;
grant execute on function process_stripe_event(jsonb) to service_role;
commit;

