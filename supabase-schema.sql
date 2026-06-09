-- ═══════════════════════════════════════════════════════════════════════════
--  THREAD Store — Supabase Database Schema
--  Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── PROFILES ────────────────────────────────────────────────────────────────
-- Extends Supabase's built-in auth.users table with THREAD-specific fields.
create table if not exists public.profiles (
  id             uuid  references auth.users(id) on delete cascade primary key,
  email          text  not null unique,
  name           text  not null,
  referral_code  text  not null unique,            -- THIS user's QR code
  referred_by    text,                              -- the OTHER user's code that brought them in (account-linked attribution)
  payout_method  text  default 'cash',
  payout_handle  text,
  created_at     timestamptz default now()
);

-- Add the column to existing tables that pre-date this migration
alter table public.profiles add column if not exists referred_by    text;
alter table public.profiles add column if not exists username       text;
alter table public.profiles add column if not exists first_name     text;
alter table public.profiles add column if not exists last_name      text;
alter table public.profiles add column if not exists date_of_birth  date;
alter table public.profiles add column if not exists phone          text;
alter table public.profiles add column if not exists instagram      text;
alter table public.profiles add column if not exists parent_email   text;
alter table public.profiles add column if not exists is_minor       boolean default false;
create index if not exists idx_profiles_referred_by on public.profiles(referred_by);
-- Use a unique partial index so NULLs are allowed (users without a username yet don't conflict)
create unique index if not exists idx_profiles_username_unique on public.profiles(username) where username is not null;

alter table public.profiles enable row level security;

-- Users can only read/write their own profile
create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

-- Admin can read all profiles (used by admin dashboard)
create policy "Service role can read all profiles"
  on public.profiles for select using (auth.role() = 'service_role');


-- ─── ORDERS ──────────────────────────────────────────────────────────────────
create table if not exists public.orders (
  id                 uuid  default gen_random_uuid() primary key,
  user_id            uuid  references auth.users(id),
  stripe_session_id  text,
  items              jsonb not null default '[]',
  subtotal           numeric(10,2) not null default 0,
  discount           numeric(10,2) default 0,
  total              numeric(10,2) not null default 0,
  promo_code         text,
  referral_code      text,                     -- code of the REFERRER (who sent this buyer)
  status             text  default 'pending',  -- pending | paid | shipped | delivered | refunded
  customer_email     text,
  print_file_url     text,                     -- unique QR + logo PNG sent to POD service
  buyer_qr_code      text,                     -- this BUYER's referral code (printed on their hoodie)
  pod_service        text,                     -- 'apliiq' | 'printful' | 'printify'
  pod_order_id       text,                     -- POD service's order ID for fulfilment tracking
  order_number       text,                     -- customer-facing ID, e.g. TH-LXK2M4-A7FQ
  email_sent_at      timestamptz,              -- order confirmation email timestamp
  created_at         timestamptz default now()
);

-- If the orders table already existed before, add the new columns
alter table public.orders add column if not exists print_file_url text;
alter table public.orders add column if not exists buyer_qr_code  text;
alter table public.orders add column if not exists pod_service    text;
alter table public.orders add column if not exists pod_order_id   text;
alter table public.orders add column if not exists order_number   text;
alter table public.orders add column if not exists email_sent_at  timestamptz;
alter table public.orders add column if not exists delivered_at        timestamptz;
alter table public.orders add column if not exists payment_intent_id   text;
alter table public.referral_scans add column if not exists clears_at   timestamptz;

create unique index if not exists idx_orders_order_number_unique
  on public.orders(order_number);

alter table public.orders enable row level security;

-- Users can read their own orders
create policy "Users can view own orders"
  on public.orders for select using (auth.uid() = user_id);

-- Users can insert orders (the checkout page creates the order)
create policy "Users can create orders"
  on public.orders for insert with check (true);

-- Service role (admin) can do everything
create policy "Service role full access to orders"
  on public.orders for all using (auth.role() = 'service_role');


-- ─── REFERRAL SCANS ──────────────────────────────────────────────────────────
create table if not exists public.referral_scans (
  id             uuid  default gen_random_uuid() primary key,
  referral_code  text  not null,
  referrer_id    uuid  references auth.users(id),
  converted      boolean default false,
  order_id       uuid  references public.orders(id),
  commission     numeric(10,2) default 0,
  status         text  default 'pending',  -- pending | paid
  city           text,
  country        text,
  created_at     timestamptz default now()
);

alter table public.referral_scans enable row level security;

-- Users can see their own scans
create policy "Users can view own scans"
  on public.referral_scans for select using (auth.uid() = referrer_id);

-- Anyone can insert a scan (triggered when QR is scanned)
create policy "Anyone can log a scan"
  on public.referral_scans for insert with check (true);

-- Service role (admin) can do everything
create policy "Service role full access to scans"
  on public.referral_scans for all using (auth.role() = 'service_role');


-- ─── REAL-TIME ───────────────────────────────────────────────────────────────
-- Enable real-time replication for the dashboard's live scan feed
alter publication supabase_realtime add table public.referral_scans;
alter publication supabase_realtime add table public.orders;


-- ─── INDEXES ─────────────────────────────────────────────────────────────────
create index if not exists idx_profiles_referral_code on public.profiles(referral_code);
create index if not exists idx_orders_user_id         on public.orders(user_id);
create index if not exists idx_orders_referral_code   on public.orders(referral_code);
create index if not exists idx_scans_referrer_id      on public.referral_scans(referrer_id);
create index if not exists idx_scans_referral_code    on public.referral_scans(referral_code);


-- ─── HELPER FUNCTION: auto-create profile after signup ───────────────────────
-- This trigger fires after a user signs up via Supabase Auth and creates the
-- full profile row using data from auth metadata (stored by the app at signup).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, name, referral_code, username, first_name, last_name, phone, instagram)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)),
    coalesce(
      nullif(new.raw_user_meta_data->>'referral_code', ''),
      upper(substring(md5(new.id::text), 1, 8))
    ),
    nullif(new.raw_user_meta_data->>'username', ''),
    nullif(new.raw_user_meta_data->>'first_name', ''),
    nullif(new.raw_user_meta_data->>'last_name', ''),
    nullif(new.raw_user_meta_data->>'phone', ''),
    nullif(new.raw_user_meta_data->>'instagram', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
