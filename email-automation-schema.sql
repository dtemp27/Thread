-- THREAD email automation + order-number migration
-- Run this in Supabase SQL Editor before testing the Stripe webhook.

alter table public.orders add column if not exists order_number text;
alter table public.orders add column if not exists email_sent_at timestamptz;

create unique index if not exists idx_orders_order_number_unique
  on public.orders(order_number);

create index if not exists idx_orders_email_sent_at
  on public.orders(email_sent_at);
