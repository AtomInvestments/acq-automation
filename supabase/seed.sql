-- Atom Investments — seed data
-- Run AFTER schema.sql. Idempotent (on conflict do nothing).
--
-- Seeds:
--   Users:    Mido Yasser (founder), Adam Chodes (ceo), Kabrina (operator)
--   Projects: APG (Mido + Adam — see open question in dashboard-rebuild-plan
--             about whether Adam wants day-to-day APG access right now),
--             Kin  (Mido + Adam + Kabrina)
--
-- Note on APG roster: dashboard-rebuild-plan.md flags this for Mido to
-- confirm. Today's seed includes Adam (matches current data/projects.json).
-- If Mido wants Adam OFF day-to-day APG, remove the project_members row.
--
-- Auth handling:
--   The auth.users rows must be created via Supabase Auth (magic-link
--   signup) before these seeds run. The seed below upserts the public.users
--   rows; the `auth_user_id` columns are nullable so the seed succeeds
--   even before invites are accepted. After each invitee signs in once,
--   their auth_user_id will be backfilled via a trigger (see below).

-- ---------------------------------------------------------------
-- Trigger: when an auth.users row is created, link it to the
-- pre-seeded public.users row by email.
-- ---------------------------------------------------------------
create or replace function public.link_auth_user_on_signup()
returns trigger language plpgsql security definer as $$
begin
  update public.users
     set auth_user_id = new.id,
         last_active  = now()
   where lower(email) = lower(new.email)
     and auth_user_id is null;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_auth_user_on_signup();

-- ---------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------
insert into public.users (email, name, initials, role, can_add_project, can_add_member, can_view_all)
values
  ('mido@atompropertygroup.org',        'Mido Yasser', 'MY', 'founder', true,  true,  true ),
  ('adam@atompropertygroup.org',        'Adam Chodes', 'AC', 'ceo',     true,  true,  true ),
  ('kabrina.a.richards@gmail.com',      'Kabrina',     'KR', 'operator',true,  true,  false)
on conflict (email) do update
  set name = excluded.name,
      initials = excluded.initials,
      role = excluded.role,
      can_add_project = excluded.can_add_project,
      can_add_member  = excluded.can_add_member,
      can_view_all    = excluded.can_view_all;

-- ---------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------
insert into public.projects (slug, name, full_name, tagline, lede, color, accent, status, created_by)
values
  ('apg', 'APG', 'Atom Property Group',
   'Real-estate acquisitions · the legacy RE side',
   'Real-estate acquisitions + construction services + outbound voice automation. The four-pillar build: Blake voice agent, listing pipeline, vault + self-improvement, training videos.',
   '#F5C518', '#0A1F44', 'on-hold',
   (select id from public.users where email = 'mido@atompropertygroup.org')),
  ('kin', 'Kin', 'Kin — Legacy & Pocket Guide',
   'Legacy/memorialization consumer app · APG pivot flagship',
   'ElevenLabs voice-clone + family tree (Legacy Book) plus configurable AI mentor (Pocket Guide). MVP on Replit, Sonnet 4.6 backbone.',
   '#7C5CD1', '#5B3FA8', 'active',
   (select id from public.users where email = 'mido@atompropertygroup.org'))
on conflict (slug) do update
  set name = excluded.name,
      full_name = excluded.full_name,
      lede = excluded.lede,
      color = excluded.color,
      status = excluded.status;

-- ---------------------------------------------------------------
-- Project members
-- ---------------------------------------------------------------
insert into public.project_members (project_id, user_id, role)
select p.id, u.id, 'owner'
  from public.projects p, public.users u
 where (p.slug = 'apg' and u.email = 'mido@atompropertygroup.org')
    or (p.slug = 'apg' and u.email = 'adam@atompropertygroup.org')
    or (p.slug = 'kin' and u.email = 'mido@atompropertygroup.org')
    or (p.slug = 'kin' and u.email = 'adam@atompropertygroup.org')
    or (p.slug = 'kin' and u.email = 'kabrina.a.richards@gmail.com')
on conflict do nothing;
