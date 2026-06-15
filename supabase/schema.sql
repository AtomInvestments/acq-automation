-- Atom Investments — Supabase schema
-- ---------------------------------------------------------------
-- Run order:
--   1. schema.sql  (this file — tables, RLS, indexes)
--   2. seed.sql    (Mido + Adam + Kabrina users; APG + Kin projects)
--   3. functions.sql  (RPCs that the Worker calls — added next session)
--
-- Auth model: Supabase Auth (email magic-link) for human users.
-- The Cloudflare Worker (apg-dashboard) reads the Supabase JWT
-- on each request via the @supabase/supabase-js client (server-side
-- service role for server reads; anon key + JWT for client reads).
--
-- Roles:
--   ceo       — full admin (Adam)
--   founder   — full admin (Mido)
--   operator  — daily driver (default for invited members)
--   viewer    — read-only
--
-- Permission columns (denormalized for client-side gating):
--   can_add_project, can_add_member, can_view_all
-- ---------------------------------------------------------------

-- Extensions ----------------------------------------------------
create extension if not exists "pgcrypto";

-- Users ---------------------------------------------------------
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete cascade,
  email         text unique not null,
  name          text not null,
  initials      text,
  avatar_url    text,
  role          text not null default 'operator'
                check (role in ('ceo','founder','operator','viewer')),
  can_add_project bool not null default false,
  can_add_member  bool not null default false,
  can_view_all    bool not null default false,
  created_at    timestamptz not null default now(),
  last_active   timestamptz
);

create index if not exists users_email_idx on public.users (email);
create index if not exists users_role_idx  on public.users (role);

-- Projects ------------------------------------------------------
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,        -- e.g. 'apg', 'kin'
  name          text not null,
  full_name     text,
  tagline       text,
  lede          text,
  frame         text,
  color         text not null default '#0A1F44',
  accent        text,
  status        text not null default 'active'
                check (status in ('active','on-hold','done','archived')),
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists projects_slug_idx on public.projects (slug);

-- Project members (many-to-many) -------------------------------
create table if not exists public.project_members (
  project_id    uuid not null references public.projects(id) on delete cascade,
  user_id       uuid not null references public.users(id)    on delete cascade,
  role          text not null default 'operator'
                check (role in ('owner','operator','viewer')),
  joined_at     timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_idx    on public.project_members (user_id);
create index if not exists project_members_project_idx on public.project_members (project_id);

-- Tasks ---------------------------------------------------------
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  external_id   text,                        -- legacy ID from JSON ('apg-t1')
  title         text not null,
  pillar        text,
  status        text not null default 'notstart'
                check (status in ('notstart','inflight','done','blocked','shipped')),
  assignee_id   uuid references public.users(id) on delete set null,
  owner_label   text,
  start_date    date,
  end_date      date,
  quarter       text,                        -- '2026-Q2' etc.
  blockers      text,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists tasks_project_idx    on public.tasks (project_id);
create index if not exists tasks_assignee_idx   on public.tasks (assignee_id);
create index if not exists tasks_status_idx     on public.tasks (status);
create index if not exists tasks_quarter_idx    on public.tasks (quarter);

-- Activity (feeds daily digest) --------------------------------
create table if not exists public.activity (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.users(id) on delete set null,
  project_id    uuid references public.projects(id) on delete set null,
  action        text not null,               -- 'task.completed', 'project.created', etc.
  target_kind   text,
  target_id     uuid,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists activity_created_idx  on public.activity (created_at desc);
create index if not exists activity_project_idx  on public.activity (project_id);
create index if not exists activity_user_idx     on public.activity (user_id);

-- Decisions (per-project) --------------------------------------
create table if not exists public.decisions (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  title         text not null,
  body          text,
  status        text not null default 'pending'
                check (status in ('pending','decided','dropped')),
  decided_at    date,
  created_at    timestamptz not null default now()
);

create index if not exists decisions_project_idx on public.decisions (project_id);

-- ---------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------
alter table public.users           enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks           enable row level security;
alter table public.activity        enable row level security;
alter table public.decisions       enable row level security;

-- Helper: is the auth user a project member?
create or replace function public.is_member(project_uuid uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.project_members pm
    join public.users u on u.id = pm.user_id
    where pm.project_id = project_uuid
      and u.auth_user_id = auth.uid()
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.users
    where auth_user_id = auth.uid()
      and (role = 'ceo' or role = 'founder' or can_view_all)
  );
$$;

-- Users — every authenticated user can read every user record
-- (small team; team page lists everyone). Only the user themselves
-- (or an admin) can update their record.
create policy users_select on public.users
  for select using (auth.uid() is not null);
create policy users_update_self on public.users
  for update using (auth_user_id = auth.uid() or public.is_admin())
            with check (auth_user_id = auth.uid() or public.is_admin());
create policy users_insert_admin on public.users
  for insert with check (public.is_admin());

-- Projects — readable to members + admins
create policy projects_select on public.projects
  for select using (public.is_member(id) or public.is_admin());
create policy projects_insert on public.projects
  for insert with check (public.is_admin() or exists (
    select 1 from public.users where auth_user_id = auth.uid() and can_add_project
  ));
create policy projects_update on public.projects
  for update using (public.is_member(id) or public.is_admin())
            with check (public.is_member(id) or public.is_admin());

-- project_members
create policy pm_select on public.project_members
  for select using (public.is_admin() or user_id in (
    select id from public.users where auth_user_id = auth.uid()
  ) or public.is_member(project_id));
create policy pm_insert on public.project_members
  for insert with check (public.is_admin() or exists (
    select 1 from public.users where auth_user_id = auth.uid() and can_add_member
  ));

-- Tasks — visible to members
create policy tasks_select on public.tasks
  for select using (public.is_member(project_id) or public.is_admin());
create policy tasks_modify on public.tasks
  for all using (public.is_member(project_id) or public.is_admin())
        with check (public.is_member(project_id) or public.is_admin());

-- Activity — visible to project members
create policy activity_select on public.activity
  for select using (project_id is null or public.is_member(project_id) or public.is_admin());
create policy activity_insert on public.activity
  for insert with check (auth.uid() is not null);

-- Decisions
create policy decisions_select on public.decisions
  for select using (public.is_member(project_id) or public.is_admin());
create policy decisions_modify on public.decisions
  for all using (public.is_member(project_id) or public.is_admin())
        with check (public.is_member(project_id) or public.is_admin());

-- ---------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------

-- updated_at automation
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- Auto-log task completion into activity
create or replace function public.log_task_completion()
returns trigger language plpgsql as $$
begin
  if (new.status = 'done' or new.status = 'shipped')
     and (old.status is distinct from new.status)
  then
    new.completed_at = coalesce(new.completed_at, now());
    insert into public.activity (user_id, project_id, action, target_kind, target_id, payload)
    values (
      new.assignee_id,
      new.project_id,
      'task.completed',
      'task',
      new.id,
      jsonb_build_object('title', new.title, 'pillar', new.pillar)
    );
  end if;
  return new;
end $$;

create trigger tasks_log_completion before update on public.tasks
  for each row execute function public.log_task_completion();
