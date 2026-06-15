# Supabase — Atom Investments backend

Schema + seed for the new auth + activity + project backend. **NOT YET WIRED** to the live Cloudflare Worker — see "Cutover" below. Today the dashboard still authenticates against the legacy KV-backed Worker auth. Supabase replaces it next session.

## Files

- `schema.sql` — tables, RLS policies, triggers. Idempotent.
- `seed.sql` — Mido + Adam + Kabrina users; APG + Kin projects + memberships. Idempotent.

## One-time bootstrap

1. **Create the project** at https://supabase.com (project name `atom-investments`, region `us-east-1`).
2. Grab the credentials from Settings → API:
   - `Project URL`
   - `anon public` (browser-safe)
   - `service_role` (server-only — never ship to the browser)
3. Put them in `_internal/credentials.md` (Tyler-private):
   ```
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_ANON_KEY=eyJh...
   SUPABASE_SERVICE_ROLE_KEY=eyJh...
   ```
4. Add the same three as Cloudflare Worker secrets:
   ```
   wrangler secret put SUPABASE_URL
   wrangler secret put SUPABASE_ANON_KEY
   wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   ```
5. Run the schema:
   ```
   psql "$SUPABASE_DB_URL" -f supabase/schema.sql
   psql "$SUPABASE_DB_URL" -f supabase/seed.sql
   ```
   (Or paste each file into the Supabase SQL Editor.)
6. In Supabase Auth → Providers, enable **Email** with magic-link, set redirect to `https://apg-dashboard.mithchell.workers.dev/auth/callback`.
7. Invite Adam + Kabrina from the Auth → Users page. The trigger `link_auth_user_on_signup` will hook their `auth.users` row to the pre-seeded `public.users` row by email on first sign-in.

## Schema overview

```
users              ── magic-link auth, role + permissions
projects           ── apg, kin, future
project_members    ── m2m: user × project + role
tasks              ── owns assignee, status, dates, quarter, blockers
activity           ── append-only audit log → feeds daily digest
decisions          ── per-project pending/decided flags
```

RLS policies enforce:
- Anyone authenticated can read every user row (small team).
- Projects + tasks + decisions visible only to members or admins (`ceo` / `founder` / `can_view_all`).
- `can_add_project` and `can_add_member` are explicit flags that gate inserts.

## Cutover plan (next session — Mido decides go/no-go)

1. Verify schema deploys clean and seed lands.
2. Walk Adam + Kabrina through magic-link sign-in.
3. Update the Worker `auth-legacy.ts` to also accept Supabase JWTs — dual-path while migrating.
4. Once everyone has signed in once, deprecate KV-based password auth.
5. Backfill the `tasks` table from `site/data/projects.json` (one-shot script).
6. Switch the dashboards from `fetch("data/projects.json")` to Supabase RPCs.
7. Wire the new `+ Add Project` modal in `js/atom.js` to a Worker endpoint that does:
   - Worker reads Supabase session
   - INSERT into `projects` + `project_members`
   - INSERT activity row
   - Return new project_id

## Activity → daily digest

The `activity` table is the substrate. A daily cron (Cloudflare Worker trigger at 09:00 ET) reads `activity` rows from the last 24h, groups by `project_id`, counts by `action`, and surfaces a digest on the Overview "Today" card. LLM summarization is optional; v1 is grouped counts only.

## Open questions for Mido

- **APG day-to-day:** seed includes Adam on APG. Per the rebuild plan you flagged "ASK Mido whether Adam should be on APG day-to-day before assuming." Default included today. If you want Adam OFF day-to-day APG, drop the `(slug='apg' AND email='adam@...')` row from `project_members`.
- **Kabrina role:** seeded as `operator` (not `ceo`/`founder`). She has `can_add_project=true`, `can_add_member=true`, but `can_view_all=false`. She can see Kin only. Flip if you want her to see APG too.
