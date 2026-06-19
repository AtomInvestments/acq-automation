-- Atom Investments — Phase 1 schema (agent telemetry)
-- ---------------------------------------------------------------
-- Adds the operational tables behind the 6 Phase-1 modules:
--   sms_logs            (1D — every SMS the bot sends)
--   property_enrichment (1B — ATTOM enrichment results)
--   deal_scores         (1C — per-strategy scores)
--   trust_scores        (1E — L6 fact-checker weekly trust per agent)
--   audit_logs          (1E — per-claim verification rows)
--
-- Run order (after the existing supabase/schema.sql + seed.sql):
--   psql "$SUPABASE_DB_URL" -f supabase/phase1-schema.sql
--   (or paste into the Supabase SQL Editor)
--
-- Style matches supabase/schema.sql: lowercase, `create ... if not exists`,
-- pgcrypto gen_random_uuid(), explicit indexes, RLS enabled.
--
-- Auth model: the Cloudflare Worker writes with the service_role key (bypasses
-- RLS). Human dashboard reads go through anon key + JWT, gated by the policies
-- below (any signed-in APG/Kin member can read; only service_role writes).
-- ---------------------------------------------------------------

create extension if not exists "pgcrypto";

-- Reuse the is_member / is_admin helpers from schema.sql. We add a coarse
-- "is any signed-in app user" check for the read-only telemetry tables.
create or replace function public.is_app_user()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.users u where u.auth_user_id = auth.uid()
  );
$$;

-- 1D — SMS logs -------------------------------------------------
create table if not exists public.sms_logs (
  id            uuid primary key default gen_random_uuid(),
  ghl_contact_id text not null,
  phone         text,
  first_name    text,
  message       text not null,
  trigger       text,                         -- 'contact_created' | 'stage_change'
  channel       text not null default 'ghl_conversations',
  status        int,                          -- HTTP status from GHL send
  ok            bool not null default false,
  generated_by  text not null default 'claude-haiku-4-5',
  sent_at       timestamptz not null default now()
);

create index if not exists sms_logs_contact_idx on public.sms_logs (ghl_contact_id);
create index if not exists sms_logs_sent_idx    on public.sms_logs (sent_at desc);
create unique index if not exists sms_logs_contact_firsttouch_uidx
  on public.sms_logs (ghl_contact_id)
  where trigger = 'contact_created';           -- enforce one first-touch per contact

-- 1B — Property enrichment --------------------------------------
create table if not exists public.property_enrichment (
  id               uuid primary key default gen_random_uuid(),
  ghl_contact_id   text not null,
  input_address    text not null,
  resolved_address text,
  attom_id         text,
  avm_value        numeric,
  avm_low          numeric,
  avm_high         numeric,
  avm_confidence   int,
  beds             numeric,
  baths            numeric,
  sqft             numeric,
  year_built       int,
  last_sale_amt    numeric,
  last_sale_date   date,
  owner_name       text,
  owner_mailing    text,
  motivated_score  int,                        -- 0-4
  motivated_flags  jsonb not null default '[]'::jsonb,
  cache_hit        bool not null default false,
  error            text,                        -- 'no_match' | 'address_parse_failed' | null
  enriched_at      timestamptz not null default now()
);

create index if not exists enrichment_contact_idx  on public.property_enrichment (ghl_contact_id);
create index if not exists enrichment_attom_idx    on public.property_enrichment (attom_id);
create index if not exists enrichment_motivated_idx on public.property_enrichment (motivated_score desc);

-- 1C — Deal scores ----------------------------------------------
create table if not exists public.deal_scores (
  id             uuid primary key default gen_random_uuid(),
  ghl_contact_id text not null,
  address        text,
  wholesale      int not null default 0 check (wholesale between 0 and 100),
  flip           int not null default 0 check (flip between 0 and 100),
  airbnb         int not null default 0 check (airbnb between 0 and 100),
  recommended    text check (recommended in ('Wholesale','Flip','Airbnb','Pass')),
  rationale      text,
  arv            numeric,
  asking_price   numeric,
  scored_by      text not null default 'claude-haiku-4-5',
  scored_at      timestamptz not null default now()
);

create index if not exists deal_scores_contact_idx     on public.deal_scores (ghl_contact_id);
create index if not exists deal_scores_recommended_idx on public.deal_scores (recommended);
create index if not exists deal_scores_scored_idx      on public.deal_scores (scored_at desc);

-- 1E — Trust scores (weekly per agent) --------------------------
create table if not exists public.trust_scores (
  id            uuid primary key default gen_random_uuid(),
  agent         text not null,                 -- 'property-enrichment' | 'deal-scorer' | 'sms-bot'
  iso_week      text not null,                 -- '2026-W25'
  total_claims  int not null default 0,
  verified      int not null default 0,
  failed_claims int not null default 0,        -- agent-recorded no-ops (not held against trust)
  trust_score   numeric not null default 1 check (trust_score between 0 and 1),
  snapshot_at   timestamptz not null default now()
);

create unique index if not exists trust_scores_agent_week_uidx
  on public.trust_scores (agent, iso_week);
create index if not exists trust_scores_week_idx on public.trust_scores (iso_week);

-- 1E — Audit logs (per-claim verification) ----------------------
create table if not exists public.audit_logs (
  id             uuid primary key default gen_random_uuid(),
  agent          text not null,                -- which L3 agent made the claim
  layer          text not null default 'L3',   -- 'L3' (claim) | 'L6' (verification)
  ghl_contact_id text,
  claim          jsonb not null default '{}'::jsonb,
  verified       bool,                          -- L6 result; null = not yet checked
  verify_note    text,
  iso_week       text,
  created_at     timestamptz not null default now()
);

create index if not exists audit_logs_agent_idx    on public.audit_logs (agent);
create index if not exists audit_logs_contact_idx  on public.audit_logs (ghl_contact_id);
create index if not exists audit_logs_week_idx     on public.audit_logs (iso_week);
create index if not exists audit_logs_created_idx  on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------
-- Row-Level Security
--   service_role (the Worker) bypasses RLS entirely → no write policy needed.
--   Signed-in app users get read-only access for the dashboard.
-- ---------------------------------------------------------------
alter table public.sms_logs            enable row level security;
alter table public.property_enrichment enable row level security;
alter table public.deal_scores         enable row level security;
alter table public.trust_scores        enable row level security;
alter table public.audit_logs          enable row level security;

drop policy if exists "app_users_read_sms_logs" on public.sms_logs;
create policy "app_users_read_sms_logs" on public.sms_logs
  for select using (public.is_app_user());

drop policy if exists "app_users_read_enrichment" on public.property_enrichment;
create policy "app_users_read_enrichment" on public.property_enrichment
  for select using (public.is_app_user());

drop policy if exists "app_users_read_deal_scores" on public.deal_scores;
create policy "app_users_read_deal_scores" on public.deal_scores
  for select using (public.is_app_user());

drop policy if exists "app_users_read_trust_scores" on public.trust_scores;
create policy "app_users_read_trust_scores" on public.trust_scores
  for select using (public.is_app_user());

drop policy if exists "app_users_read_audit_logs" on public.audit_logs;
create policy "app_users_read_audit_logs" on public.audit_logs
  for select using (public.is_app_user());
