/**
 * admin-v2.ts — Multi-user access control for the APG dashboard.
 *
 * Replaces the single-tenant `DASHBOARD_PASSWORD` model with a per-user
 * email/password login backed by KV, plus role-based + per-tab permissions
 * gating every dashboard route.
 *
 * Storage model (Cloudflare KV, namespace `DIAL_STATE`):
 *   user:<email_lowercase>          → JSON { email, name, role, permissions,
 *                                            password_hash, password_salt,
 *                                            template, created_at, created_by,
 *                                            last_login }
 *   session:<session_id>            → JSON { email, role, created_at,
 *                                            expires_at, ip? } — TTL 24h
 *   ratelimit:login:<ip>            → counter (TTL 15m) for brute-force
 *   audit:<iso_ts>:<actor_email>    → JSON { action, target, actor, details }
 *                                     TTL 90 days
 *   template:<slug>                 → JSON { slug, name, description,
 *                                            permissions } (employee templates)
 *
 * Backwards compat:
 *   - The legacy "mido" single-tenant login still works during migration.
 *     /login accepts an email OR the bare username "mido"; if no email is
 *     supplied, falls back to env.DASHBOARD_PASSWORD constant-time check.
 *   - The legacy session cookie format remains valid — requireAuthV2 will
 *     recognize old cookies and treat them as a synthetic "mido" Manager
 *     session with full permissions.
 *
 * Security:
 *   - Passwords are hashed with SHA-256 using a per-user 16-byte random salt
 *     plus the global DASHBOARD_SESSION_SECRET as pepper. Stored as hex.
 *   - Session IDs are 32-byte random hex from crypto.getRandomValues, opaque
 *     to clients (KV stores the actual session payload).
 *   - Session cookies are HttpOnly + Secure + SameSite=Lax + 24h Max-Age.
 *   - /login is rate-limited to 5 attempts per IP per 15 min.
 *   - Audit log records every user create / delete / permission change.
 *
 * Adam-readable bar: every page here is something Adam will use and see.
 * No cross-lane references, no personal Mido content, no money/comp/equity,
 * no commentary critical of Adam.
 */

import type { Env } from "./index";

// =============================================================================
// Types + permission schema
// =============================================================================

export type Role = "ceo" | "manager" | "employee";

// Permission keys — every nav tab + every sensitive surface gets a key.
// Booleans only. To grant a new tab, add the key here AND in TAB_PERMS_ALL
// AND in the nav filter in index.ts apgTopNav.
export interface Permissions {
  // Tab visibility (matches the 10 tabs in apgTopNav + the 2 admin-only tabs)
  hub: boolean;          // GET /             (Desk / Operations Console)
  blake: boolean;        // GET /blake        (voice agent live calls)
  progress: boolean;     // GET /progress     (Tracker)
  roadmap: boolean;      // GET /roadmap
  followups: boolean;    // GET /followups
  deals: boolean;        // GET /deals
  weekly: boolean;       // GET /weekly       (Docket)
  priorities: boolean;   // GET /priorities   (Priority)
  markets: boolean;      // GET /markets
  insights: boolean;     // GET /insights     (Website snapshots + Clarity)
  websites: boolean;     // GET /websites
  dashboard: boolean;    // GET /dashboard    (v2 ops dashboard)
  messages: boolean;     // GET /messages     (Airbnb host inbox analytics)

  // Sensitive surfaces (role-gated even if true)
  can_view_credentials: boolean;
  can_view_costs: boolean;
  can_view_blake_calls: boolean;   // raw call transcripts/recordings
  can_export_data: boolean;        // CSV / motivated-sellers exports

  // Admin powers (CEO/Manager only — employees can never have these true)
  can_add_users: boolean;
  can_remove_users: boolean;
}

export const PERM_KEYS: Array<keyof Permissions> = [
  "hub", "blake", "progress", "roadmap", "followups", "deals",
  "weekly", "priorities", "markets", "insights", "websites", "dashboard", "messages",
  "can_view_credentials", "can_view_costs", "can_view_blake_calls",
  "can_export_data", "can_add_users", "can_remove_users",
];

export interface User {
  email: string;          // lowercase, unique
  name: string;
  role: Role;
  template?: string;      // slug of seeded template if employee
  permissions: Permissions;
  password_hash: string;  // hex of SHA-256(password + salt + pepper)
  password_salt: string;  // hex 16 bytes
  created_at: string;     // ISO
  created_by: string;     // email of creator (or "bootstrap")
  last_login?: string;    // ISO
}

export interface SessionPayload {
  email: string;
  role: Role;
  created_at: string;
  expires_at: string;
  ip?: string;
}

export interface AdminTemplate {
  slug: string;
  name: string;
  description: string;
  permissions: Permissions;
  builtin?: boolean;      // seeded templates can't be deleted
}

export interface AuditEntry {
  ts: string;
  actor: string;
  action: string;
  target?: string;
  details?: Record<string, unknown>;
}

// =============================================================================
// Permission helpers
// =============================================================================

export function permsAllTrue(): Permissions {
  const p: Partial<Permissions> = {};
  for (const k of PERM_KEYS) (p as any)[k] = true;
  return p as Permissions;
}

export function permsAllFalse(): Permissions {
  const p: Partial<Permissions> = {};
  for (const k of PERM_KEYS) (p as any)[k] = false;
  return p as Permissions;
}

export function permsMerge(base: Permissions, override: Partial<Permissions>): Permissions {
  return { ...base, ...override };
}

// Role defaults — CEO and Manager get everything; Employee gets nothing
// (template fills in the actual visibility).
export function defaultPermsForRole(role: Role): Permissions {
  if (role === "ceo" || role === "manager") {
    const p = permsAllTrue();
    // Even managers don't get can_view_credentials by default — that's a CEO
    // flag. Mido is the exception via the bootstrap (he wired this), and Adam
    // gets it as CEO.
    if (role === "manager") p.can_view_credentials = false;
    return p;
  }
  return permsAllFalse();
}

// Employees can never hold admin powers. This is enforced server-side on
// every save, not just the form.
export function clampPermsForRole(role: Role, p: Permissions): Permissions {
  if (role === "employee") {
    return { ...p, can_add_users: false, can_remove_users: false, can_view_credentials: false };
  }
  if (role === "manager") {
    return { ...p, can_view_credentials: false };
  }
  return p;
}

// =============================================================================
// Seeded employee templates
// =============================================================================

function tplPerms(visible: Array<keyof Permissions>): Permissions {
  const p = permsAllFalse();
  for (const k of visible) p[k] = true;
  // Every employee gets the hub by default — it's just the landing page.
  p.hub = true;
  return p;
}

export const BUILTIN_TEMPLATES: AdminTemplate[] = [
  {
    slug: "acq_specialist",
    name: "Acquisitions Specialist",
    description: "Acquisitions partner role — live calls, leads, pipeline, voice review. No cost surfaces.",
    permissions: tplPerms(["hub", "blake", "deals", "followups", "progress", "priorities", "weekly", "dashboard", "can_view_blake_calls"]),
    builtin: true,
  },
  {
    slug: "analyst",
    name: "Analyst (Read-Only)",
    description: "Read-only access to KPIs, market data, and weekly docket. No live call playback.",
    permissions: tplPerms(["hub", "weekly", "markets", "insights", "priorities", "can_view_costs"]),
    builtin: true,
  },
  {
    slug: "ops_manager",
    name: "Operations Manager",
    description: "Full operating view except credentials, raw call playback, and cost panels.",
    permissions: tplPerms(["hub", "blake", "progress", "roadmap", "followups", "deals", "weekly", "priorities", "markets", "insights", "websites", "dashboard"]),
    builtin: true,
  },
  {
    slug: "vendor_view",
    name: "Vendor / Contractor",
    description: "Minimal view — landing hub plus the Tracker only.",
    permissions: tplPerms(["hub", "progress"]),
    builtin: true,
  },
];

// =============================================================================
// Crypto + password helpers (WebCrypto, Worker-safe)
// =============================================================================

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

function randomHex(byteLen: number): string {
  const b = new Uint8Array(byteLen);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

export async function hashPassword(password: string, salt: string, pepper: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = enc.encode(`${password}:${salt}:${pepper}`);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return bytesToHex(new Uint8Array(digest));
}

// Constant-time hex compare
function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// XKCD-style passphrase generator — used by /admin/users/new and the
// bootstrap routine. Long enough to be secure, short enough to type.
const PASSPHRASE_WORDS = [
  "cedar","anvil","prism","harbor","quartz","meadow","silver","copper","timber",
  "river","cobalt","marble","willow","flint","beacon","canyon","glacier","orchid",
  "tundra","zenith","amber","onyx","jasper","crimson","azure","indigo","ember",
  "frost","solstice","equinox","wolfram","tungsten","obsidian","basalt","granite",
  "linen","velvet","cypher","vortex","arbor",
];
export function generatePassphrase(): string {
  const r = new Uint32Array(5);
  crypto.getRandomValues(r);
  const pick = (i: number) => PASSPHRASE_WORDS[r[i] % PASSPHRASE_WORDS.length];
  const num = String((r[2] % 90) + 10);
  const suffix = ((r[4] >>> 0).toString(36) + "AA").slice(0, 2).toUpperCase();
  return `${pick(0)}-${pick(1)}-${num}-${pick(3)}-${suffix}`;
}

// =============================================================================
// KV ops — users
// =============================================================================

const USER_PREFIX = "user:";
const SESSION_PREFIX = "session:";
const TEMPLATE_PREFIX = "template:";
const AUDIT_PREFIX = "audit:";
const RATELIMIT_PREFIX = "ratelimit:login:";

// Index keys — avoid expensive KV.list() on every page load by maintaining a
// hand-curated index of emails / template slugs / recent audit entries.
// The DIAL_STATE namespace is shared with high-volume dial dedupe writes that
// blow through the daily KV list-quota; admin pages MUST NOT call .list().
const USERS_INDEX_KEY = "users:index";        // JSON string[] of emails
const AUDIT_INDEX_KEY = "audit:index";        // JSON: { entries: [{...}], cap: 200 }
const AUDIT_INDEX_CAP = 200;

export function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export async function getUser(env: Env, email: string): Promise<User | null> {
  const key = USER_PREFIX + normalizeEmail(email);
  const raw = await env.DIAL_STATE.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as User; } catch { return null; }
}

async function readUsersIndex(env: Env): Promise<string[]> {
  const raw = await env.DIAL_STATE.get(USERS_INDEX_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
  } catch { return []; }
}

async function writeUsersIndex(env: Env, emails: string[]): Promise<void> {
  const uniq = Array.from(new Set(emails.map(normalizeEmail))).sort();
  await env.DIAL_STATE.put(USERS_INDEX_KEY, JSON.stringify(uniq));
}

export async function putUser(env: Env, u: User): Promise<void> {
  u.email = normalizeEmail(u.email);
  u.permissions = clampPermsForRole(u.role, u.permissions);
  await env.DIAL_STATE.put(USER_PREFIX + u.email, JSON.stringify(u));
  // Maintain the index so listUsers() doesn't have to call KV.list().
  const idx = await readUsersIndex(env);
  if (!idx.includes(u.email)) {
    idx.push(u.email);
    await writeUsersIndex(env, idx);
  }
}

export async function deleteUser(env: Env, email: string): Promise<void> {
  const e = normalizeEmail(email);
  await env.DIAL_STATE.delete(USER_PREFIX + e);
  const idx = await readUsersIndex(env);
  const next = idx.filter((x) => x !== e);
  if (next.length !== idx.length) await writeUsersIndex(env, next);
}

export async function listUsers(env: Env): Promise<User[]> {
  // Read the curated index — no KV.list() (the namespace is shared with
  // high-volume dial dedupe writes and KV.list daily quota fills fast).
  const emails = await readUsersIndex(env);
  const out: User[] = [];
  for (const e of emails) {
    const u = await getUser(env, e);
    if (u) out.push(u);
  }
  return out;
}

// =============================================================================
// KV ops — sessions
// =============================================================================

export async function createSession(env: Env, user: User, ip?: string): Promise<string> {
  const sid = randomHex(32);
  const now = new Date();
  const exp = new Date(now.getTime() + 24 * 3600 * 1000);
  const payload: SessionPayload = {
    email: user.email,
    role: user.role,
    created_at: now.toISOString(),
    expires_at: exp.toISOString(),
    ip,
  };
  await env.DIAL_STATE.put(SESSION_PREFIX + sid, JSON.stringify(payload), {
    expirationTtl: 24 * 3600,
  });
  return sid;
}

export async function getSession(env: Env, sid: string): Promise<SessionPayload | null> {
  if (!sid) return null;
  const raw = await env.DIAL_STATE.get(SESSION_PREFIX + sid);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as SessionPayload;
    if (new Date(p.expires_at).getTime() < Date.now()) return null;
    return p;
  } catch { return null; }
}

export async function deleteSession(env: Env, sid: string): Promise<void> {
  if (!sid) return;
  await env.DIAL_STATE.delete(SESSION_PREFIX + sid);
}

// =============================================================================
// KV ops — templates
// =============================================================================

export async function getTemplate(env: Env, slug: string): Promise<AdminTemplate | null> {
  if (!slug) return null;
  // Try KV first (allows admins to extend), fall back to builtin
  const raw = await env.DIAL_STATE.get(TEMPLATE_PREFIX + slug);
  if (raw) {
    try { return JSON.parse(raw) as AdminTemplate; } catch {}
  }
  return BUILTIN_TEMPLATES.find((t) => t.slug === slug) || null;
}

export async function listTemplates(env: Env): Promise<AdminTemplate[]> {
  // Builtins only, for now. The custom-template editor is deferred to next
  // session; once it ships, this should also read a curated index key (e.g.
  // "templates:index") rather than KV.list(), because the DIAL_STATE
  // namespace's list quota is shared with high-volume dial dedupe.
  return [...BUILTIN_TEMPLATES];
}

export async function putTemplate(env: Env, t: AdminTemplate): Promise<void> {
  await env.DIAL_STATE.put(TEMPLATE_PREFIX + t.slug, JSON.stringify(t));
}

// =============================================================================
// Audit log
// =============================================================================

// Audit log uses a single rolling-buffer key — read-modify-write — to avoid
// per-event KV.list() and per-event TTL overhead. Cap at AUDIT_INDEX_CAP
// most-recent entries; older entries fall off as new ones arrive. Good enough
// for an in-dashboard recent-activity widget; not a forensics tool.
async function readAuditBuffer(env: Env): Promise<AuditEntry[]> {
  const raw = await env.DIAL_STATE.get(AUDIT_INDEX_KEY);
  if (!raw) return [];
  try {
    const obj = JSON.parse(raw);
    if (Array.isArray(obj?.entries)) return obj.entries.filter((e: any) => e && typeof e.ts === "string");
  } catch {}
  return [];
}

export async function audit(env: Env, entry: Omit<AuditEntry, "ts">): Promise<void> {
  const ts = new Date().toISOString();
  const full: AuditEntry = { ts, ...entry };
  const buf = await readAuditBuffer(env);
  buf.unshift(full);
  const trimmed = buf.slice(0, AUDIT_INDEX_CAP);
  await env.DIAL_STATE.put(AUDIT_INDEX_KEY, JSON.stringify({ entries: trimmed, cap: AUDIT_INDEX_CAP }));
}

export async function listRecentAudit(env: Env, limit = 25): Promise<AuditEntry[]> {
  const buf = await readAuditBuffer(env);
  return buf.slice(0, limit);
}

// =============================================================================
// Rate limit (login brute-force)
// =============================================================================

export async function checkLoginRateLimit(env: Env, ip: string): Promise<{ ok: boolean; remaining: number }> {
  const key = RATELIMIT_PREFIX + ip;
  const raw = await env.DIAL_STATE.get(key);
  const n = raw ? Number(raw) : 0;
  if (n >= 5) return { ok: false, remaining: 0 };
  return { ok: true, remaining: 5 - n };
}

export async function bumpLoginRateLimit(env: Env, ip: string): Promise<void> {
  const key = RATELIMIT_PREFIX + ip;
  const raw = await env.DIAL_STATE.get(key);
  const n = raw ? Number(raw) : 0;
  await env.DIAL_STATE.put(key, String(n + 1), { expirationTtl: 15 * 60 });
}

// =============================================================================
// Bootstrap — runs idempotently on first request after deploy.
// Seeds the 3 initial managers + the 4 builtin templates into KV.
//
// Bootstrap passphrases are KNOWN-VALUE (generated out-of-band and pasted
// into APG-Vault/_internal/credentials.md). This avoids the "scrape Worker
// logs to recover the password" antipattern. Once a user logs in, they can
// rotate via /me.
// =============================================================================

interface BootstrapSeed {
  email: string;
  name: string;
  role: Role;
  password: string;
}

const BOOTSTRAP_SEEDS: BootstrapSeed[] = [
  {
    email: "adam@atompropertygroup.org",
    name: "Adam Chodes",
    role: "ceo",
    password: "indigo-jasper-83-solstice-C1",
  },
  {
    email: "kebrina.a.richards@gmail.com",
    name: "Kebrina Richards",
    role: "manager",
    password: "solstice-timber-63-beacon-YE",
  },
  {
    email: "mido@atompropertygroup.org",
    name: "Mike Yasser",
    role: "manager",
    password: "onyx-zenith-64-harbor-VK",
  },
];

const BOOTSTRAP_SENTINEL_KEY = "bootstrap:v1:done";

export async function bootstrapIfNeeded(env: Env): Promise<{ ran: boolean; seeded: string[]; reindexed: number }> {
  const sentinel = await env.DIAL_STATE.get(BOOTSTRAP_SENTINEL_KEY);

  const seeded: string[] = [];
  if (sentinel !== "v2") {
    for (const s of BOOTSTRAP_SEEDS) {
      const existing = await getUser(env, s.email);
      if (existing) continue;
      const salt = randomHex(16);
      const hash = await hashPassword(s.password, salt, env.DASHBOARD_SESSION_SECRET || "fallback-pepper");
      const u: User = {
        email: s.email,
        name: s.name,
        role: s.role,
        permissions: defaultPermsForRole(s.role),
        password_hash: hash,
        password_salt: salt,
        created_at: new Date().toISOString(),
        created_by: "bootstrap",
      };
      // Adam (CEO) gets credential viewing; managers (Kebrina, Mido) don't.
      if (s.role === "ceo") u.permissions.can_view_credentials = true;
      await putUser(env, u);
      seeded.push(s.email);
    }
  }

  // ALWAYS make sure the users:index includes the seeded emails (in case
  // bootstrap ran before the index existed in an earlier deploy).
  const idx = await readUsersIndex(env);
  let reindexed = 0;
  for (const s of BOOTSTRAP_SEEDS) {
    if (!idx.includes(s.email)) {
      idx.push(s.email);
      reindexed++;
    }
  }
  if (reindexed > 0) await writeUsersIndex(env, idx);

  // Bump the sentinel to v2 so we don't re-run the seeding side; the
  // reindexing side is now idempotent and runs on every boot until idx is
  // synced.
  await env.DIAL_STATE.put(BOOTSTRAP_SENTINEL_KEY, "v2");
  return { ran: seeded.length > 0 || reindexed > 0, seeded, reindexed };
}

/**
 * Re-seed the bootstrap users' passwords against the CURRENT
 * `DASHBOARD_SESSION_SECRET`. Required after the secret is rotated — the old
 * stored `password_hash` was computed against the old pepper and will never
 * match anymore.
 *
 * Unlike `bootstrapIfNeeded`, this:
 *   - Always overwrites the password_hash + password_salt for the 3 seeds,
 *     even if the user record already exists.
 *   - Preserves role, permissions, created_at, created_by on existing
 *     records — only credentials change.
 *   - Creates the user record if it's missing (safety net).
 *
 * Designed to be triggered from a one-shot admin route. Idempotent — safe to
 * run repeatedly; each run resets the 3 users to their bootstrap passphrases.
 */
export async function reseedBootstrapPasswords(env: Env): Promise<{ reseeded: string[]; created: string[] }> {
  const reseeded: string[] = [];
  const created: string[] = [];
  for (const s of BOOTSTRAP_SEEDS) {
    const salt = randomHex(16);
    const hash = await hashPassword(s.password, salt, env.DASHBOARD_SESSION_SECRET || "fallback-pepper");
    const existing = await getUser(env, s.email);
    if (existing) {
      existing.password_hash = hash;
      existing.password_salt = salt;
      await putUser(env, existing);
      reseeded.push(s.email);
    } else {
      const u: User = {
        email: s.email,
        name: s.name,
        role: s.role,
        permissions: defaultPermsForRole(s.role),
        password_hash: hash,
        password_salt: salt,
        created_at: new Date().toISOString(),
        created_by: "bootstrap-reseed",
      };
      if (s.role === "ceo") u.permissions.can_view_credentials = true;
      await putUser(env, u);
      created.push(s.email);
    }
  }
  return { reseeded, created };
}

// =============================================================================
// Forgot-password — KV-backed request queue (Option C: no email infra)
// =============================================================================
//
// Public form at /forgot writes a "pending" entry. Managers see the queue at
// /admin/password-requests and click "Reset" to issue a fresh passphrase
// (shown ONCE on screen). No email sent — manager relays via Slack/SMS.

export interface PasswordRequest {
  email: string;       // normalized
  ts: string;          // ISO submitted
  ip: string;          // requester IP (for abuse trace)
  status: "pending" | "fulfilled" | "ignored";
  fulfilled_by?: string;
  fulfilled_at?: string;
}

const PASSWORD_REQUEST_PREFIX = "password-request:";
const PASSWORD_REQUEST_INDEX = "password-requests:index";
const PASSWORD_REQUEST_INDEX_CAP = 100;

interface PasswordRequestIndexEntry {
  key: string;     // full KV key
  email: string;
  ts: string;
  status: "pending" | "fulfilled" | "ignored";
}

async function readPasswordRequestIndex(env: Env): Promise<PasswordRequestIndexEntry[]> {
  const raw = await env.DIAL_STATE.get(PASSWORD_REQUEST_INDEX);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function writePasswordRequestIndex(env: Env, entries: PasswordRequestIndexEntry[]): Promise<void> {
  // Newest first, capped.
  const sorted = entries.slice().sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, PASSWORD_REQUEST_INDEX_CAP);
  await env.DIAL_STATE.put(PASSWORD_REQUEST_INDEX, JSON.stringify(sorted));
}

export async function createPasswordRequest(env: Env, email: string, ip: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const ts = new Date().toISOString();
  const key = `${PASSWORD_REQUEST_PREFIX}${normalized}:${ts}`;
  const req: PasswordRequest = { email: normalized, ts, ip, status: "pending" };
  // 30 day TTL so the queue self-prunes if no manager acts.
  await env.DIAL_STATE.put(key, JSON.stringify(req), { expirationTtl: 30 * 24 * 3600 });
  const idx = await readPasswordRequestIndex(env);
  idx.push({ key, email: normalized, ts, status: "pending" });
  await writePasswordRequestIndex(env, idx);
}

export async function listPasswordRequests(env: Env): Promise<Array<PasswordRequest & { key: string }>> {
  const idx = await readPasswordRequestIndex(env);
  const out: Array<PasswordRequest & { key: string }> = [];
  for (const e of idx) {
    const raw = await env.DIAL_STATE.get(e.key);
    if (!raw) continue;
    try {
      const r = JSON.parse(raw) as PasswordRequest;
      out.push({ ...r, key: e.key });
    } catch { /* skip */ }
  }
  return out;
}

export async function fulfillPasswordRequest(env: Env, key: string, fulfilledBy: string, status: "fulfilled" | "ignored" = "fulfilled"): Promise<void> {
  const raw = await env.DIAL_STATE.get(key);
  if (!raw) return;
  try {
    const r = JSON.parse(raw) as PasswordRequest;
    r.status = status;
    r.fulfilled_by = fulfilledBy;
    r.fulfilled_at = new Date().toISOString();
    await env.DIAL_STATE.put(key, JSON.stringify(r), { expirationTtl: 30 * 24 * 3600 });
  } catch { /* swallow */ }
  // Update index status too.
  const idx = await readPasswordRequestIndex(env);
  for (const e of idx) {
    if (e.key === key) e.status = status;
  }
  await writePasswordRequestIndex(env, idx);
}

// Rate limit /forgot — 3 requests per IP per hour, prevent abuse-spam of the queue.
export async function checkForgotRateLimit(env: Env, ip: string): Promise<{ ok: boolean; remaining: number }> {
  const key = `ratelimit:forgot:${ip}`;
  const raw = await env.DIAL_STATE.get(key);
  const n = raw ? parseInt(raw, 10) || 0 : 0;
  return { ok: n < 3, remaining: Math.max(0, 3 - n) };
}

export async function bumpForgotRateLimit(env: Env, ip: string): Promise<void> {
  const key = `ratelimit:forgot:${ip}`;
  const raw = await env.DIAL_STATE.get(key);
  const n = (raw ? parseInt(raw, 10) || 0 : 0) + 1;
  await env.DIAL_STATE.put(key, String(n), { expirationTtl: 3600 });
}


// =============================================================================
// Auth — verify password + require permission
// =============================================================================

export async function verifyPassword(env: Env, email: string, password: string): Promise<User | null> {
  const u = await getUser(env, email);
  if (!u) return null;
  const expected = await hashPassword(password, u.password_salt, env.DASHBOARD_SESSION_SECRET || "fallback-pepper");
  if (!safeHexEqual(expected, u.password_hash)) return null;
  return u;
}

export interface AuthV2Result {
  ok: boolean;
  user?: User;
  legacy?: boolean;     // true if this is the backwards-compat single-tenant cookie
  reason?: string;
}

const V2_COOKIE_NAME = "apg_session_v2";

function getCookieValue(req: Request, name: string): string {
  const header = req.headers.get("cookie") || "";
  for (const pair of header.split(";")) {
    const [k, ...rest] = pair.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return "";
}

export function buildV2CookieHeader(sid: string): string {
  return [
    `${V2_COOKIE_NAME}=${sid}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${24 * 3600}`,
  ].join("; ");
}

export function clearV2CookieHeader(): string {
  return [
    `${V2_COOKIE_NAME}=`,
    "HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=0",
  ].join("; ");
}

// Synthetic "mido" user reconstructed from a legacy cookie. Lets the old
// session work during migration without rewriting every route.
export function legacyMidoSyntheticUser(): User {
  return {
    email: "mido@atompropertygroup.org",
    name: "Mike Yasser",
    role: "manager",
    permissions: defaultPermsForRole("manager"),
    password_hash: "",
    password_salt: "",
    created_at: new Date(0).toISOString(),
    created_by: "legacy-cookie",
  };
}

export async function requireAuthV2(req: Request, env: Env): Promise<AuthV2Result> {
  // 1. Try v2 cookie first.
  const sid = getCookieValue(req, V2_COOKIE_NAME);
  if (sid) {
    const sess = await getSession(env, sid);
    if (sess) {
      const u = await getUser(env, sess.email);
      if (u) return { ok: true, user: u };
    }
  }
  // 2. Fall back to legacy apg_session cookie (single-tenant mido).
  const legacy = getCookieValue(req, "apg_session");
  if (legacy) {
    // Lazy import to avoid circular dep at module load.
    const { verifyLegacySessionCookie } = await import("./auth-legacy");
    const v = await verifyLegacySessionCookie(legacy, env.DASHBOARD_SESSION_SECRET);
    if (v.ok) return { ok: true, user: legacyMidoSyntheticUser(), legacy: true };
  }
  return { ok: false, reason: "no_valid_session" };
}

export function hasPermission(u: User | undefined, key: keyof Permissions): boolean {
  if (!u) return false;
  return Boolean(u.permissions?.[key]);
}

// =============================================================================
// HTML — claymorphism admin pages
// =============================================================================
//
// Style brief (ui-ux-pro-max — Editorial Claymorphism, mobile-first 380px):
//   - Cream surface (#FAF7EC) with subtle radial wash; cards float on multi-
//     layer soft shadows (no harsh edges, no hard borders).
//   - Display type Fraunces (editorial serif); body Inter; technical numerics
//     JetBrains Mono. Matches the live /roadmap page.
//   - Navy (#0A1F44) for primary actions, gold (#F5C518) for accent + active
//     state, never neon. Pressed state = inset shadow (debossed clay).
//   - Permission grid: 3-column responsive (1col @ mobile), each row = one
//     permission with a clay-style toggle. Group tabs/sensitive/admin so the
//     non-technical CEO sees structure not a wall of checkboxes.
//   - Role/template pickers use clay-style native <select> (zero JS deps for
//     core flow — Workers HTML, no React).
//   - Tables use cream-2 row stripe + hover-lift; never zebra grey.
//   - All primary CTAs are full-bleed buttons on mobile, max-content on desktop.

const ADMIN_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }

:root {
  --cream:     #FAF7EC;
  --cream-2:   #F5EFD8;
  --cream-3:   #EFE7CC;
  --gold:      #F5C518;
  --gold-soft: #FFE58A;
  --navy:      #0A1F44;
  --navy-2:    #1A2840;
  --ink:       #09090B;
  --muted:     #6B7280;
  --rule:      #E8E0C8;
  --green:    #4E7A4C;
  --red:      #9C3D3D;
  --yellow:   #B8893A;

  --clay-r-lg: 20px;
  --clay-r-md: 14px;
  --clay-r-sm: 10px;

  --clay-shadow:
    0 1px 2px  rgba(10, 31, 68, 0.04),
    0 6px 14px rgba(10, 31, 68, 0.07),
    0 14px 32px rgba(10, 31, 68, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.85);
  --clay-shadow-hover:
    0 2px 4px rgba(10, 31, 68, 0.06),
    0 10px 22px rgba(10, 31, 68, 0.10),
    0 22px 44px rgba(10, 31, 68, 0.09),
    inset 0 1px 0 rgba(255, 255, 255, 0.92);
  --clay-shadow-inset:
    inset 0 2px 4px rgba(10, 31, 68, 0.08),
    inset 0 -1px 0 rgba(255, 255, 255, 0.6);

  --ease-clay: cubic-bezier(0.34, 1.4, 0.5, 1);
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.55;
  color: var(--ink);
  background:
    radial-gradient(circle at 20% 0%, #FFFBEC 0%, transparent 55%),
    radial-gradient(circle at 100% 100%, #F2EAD0 0%, transparent 60%),
    var(--cream);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}

.adm-main {
  max-width: 1160px;
  margin: 0 auto;
  padding: 32px 24px 96px;
}
@media (max-width: 600px) { .adm-main { padding: 20px 16px 64px; } }

.adm-hero {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 16px;
  margin-bottom: 28px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--rule);
}
.adm-hero h1 {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: clamp(28px, 4.2vw, 42px);
  line-height: 1.08;
  letter-spacing: -0.02em;
  margin: 0 0 6px;
  color: var(--navy);
}
.adm-hero h1 em { color: var(--gold); font-style: italic; font-weight: 500; }
.adm-hero p {
  font-family: 'Inter', sans-serif;
  font-size: 14px; color: var(--muted); margin: 0;
}
.adm-hero .btn-row { display: flex; gap: 10px; flex-wrap: wrap; }

.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 11px 18px;
  font: 600 13px/1 'Inter', sans-serif;
  letter-spacing: 0.02em;
  border-radius: var(--clay-r-md);
  border: none;
  background: #fff;
  color: var(--navy);
  text-decoration: none;
  cursor: pointer;
  box-shadow: var(--clay-shadow);
  transition: box-shadow 200ms var(--ease-clay), transform 200ms var(--ease-clay);
}
.btn:hover { box-shadow: var(--clay-shadow-hover); transform: translateY(-1px); }
.btn:active { box-shadow: var(--clay-shadow-inset); transform: translateY(0); }
.btn-primary { background: var(--navy); color: var(--cream); }
.btn-primary:hover { background: var(--navy-2); }
.btn-gold { background: var(--gold); color: var(--navy); }
.btn-danger { background: #fff; color: var(--red); }

.card {
  background: #fff;
  border-radius: var(--clay-r-lg);
  box-shadow: var(--clay-shadow);
  padding: 24px;
  margin-bottom: 20px;
}
@media (max-width: 600px) { .card { padding: 18px; border-radius: var(--clay-r-md); } }

.card h2 {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500; font-size: 22px;
  margin: 0 0 4px; color: var(--navy);
  letter-spacing: -0.01em;
}
.card .sub {
  font-size: 13px; color: var(--muted); margin: 0 0 18px;
}

/* User list table */
.adm-table-wrap { overflow-x: auto; }
.adm-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 14px;
}
.adm-table thead th {
  text-align: left;
  font: 600 10px/1 'Inter', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--muted);
  padding: 12px 14px;
  border-bottom: 1px solid var(--rule);
  background: transparent;
}
.adm-table tbody td {
  padding: 14px;
  background: var(--cream);
  border-bottom: 4px solid #fff;
}
.adm-table tbody tr:first-child td:first-child { border-top-left-radius: var(--clay-r-sm); }
.adm-table tbody tr:first-child td:last-child  { border-top-right-radius: var(--clay-r-sm); }
.adm-table tbody tr:hover td { background: var(--cream-2); }

.role-badge {
  display: inline-block;
  padding: 4px 10px;
  font: 600 10px/1 'Inter', sans-serif;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border-radius: 999px;
  box-shadow: var(--clay-shadow);
}
.role-ceo      { background: var(--gold);    color: var(--navy); }
.role-manager  { background: #fff;           color: var(--navy); }
.role-employee { background: var(--cream-2); color: var(--navy); }

.adm-table .user-name {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 600; font-size: 16px;
  color: var(--navy);
  letter-spacing: -0.005em;
}
.adm-table .user-email {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px; color: var(--muted);
}
.adm-table .row-actions {
  display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end;
}
.adm-table .row-actions a {
  font: 600 11px/1 'Inter', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--navy);
  text-decoration: none;
  padding: 6px 10px;
  border-radius: var(--clay-r-sm);
  background: #fff;
  box-shadow: var(--clay-shadow);
  transition: box-shadow 160ms var(--ease-clay);
}
.adm-table .row-actions a:hover { box-shadow: var(--clay-shadow-hover); }
.adm-table .row-actions a.danger { color: var(--red); }

/* Form layout */
form.adm-form { display: grid; gap: 18px; }
.field { display: grid; gap: 6px; }
.field label {
  font: 600 10px/1 'Inter', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--muted);
}
.field input[type=text],
.field input[type=email],
.field input[type=password],
.field select {
  font: 400 15px/1.4 'Inter', sans-serif;
  padding: 12px 14px;
  border-radius: var(--clay-r-md);
  background: var(--cream);
  border: none;
  color: var(--ink);
  box-shadow: var(--clay-shadow-inset);
  width: 100%;
}
.field input:focus, .field select:focus {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}

/* Permission grid */
.perm-section { margin-top: 6px; }
.perm-section h3 {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: 17px;
  color: var(--navy);
  letter-spacing: -0.005em;
  margin: 18px 0 10px;
}
.perm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.perm-tile {
  display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px;
  padding: 12px 14px;
  background: var(--cream);
  border-radius: var(--clay-r-md);
  box-shadow: var(--clay-shadow);
  transition: box-shadow 160ms var(--ease-clay);
  cursor: pointer;
}
.perm-tile:hover { box-shadow: var(--clay-shadow-hover); }
.perm-tile input[type=checkbox] {
  width: 22px; height: 22px;
  accent-color: var(--gold);
  cursor: pointer;
}
.perm-tile .perm-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--navy);
}
.perm-tile .perm-key {
  display: block;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--muted);
  margin-top: 3px;
  font-weight: 400;
}

/* Alert + banner */
.alert {
  padding: 14px 16px;
  border-radius: var(--clay-r-md);
  margin-bottom: 18px;
  font-size: 14px;
  background: #FFF4E5;
  box-shadow: 0 2px 6px rgba(245, 158, 11, 0.12), inset 4px 0 0 #F59E0B;
}
.alert.success { background: #E8F8F0; box-shadow: 0 2px 6px rgba(46, 194, 126, 0.12), inset 4px 0 0 var(--green); }
.alert.error   { background: #FDECEA; box-shadow: 0 2px 6px rgba(192, 57, 43, 0.12), inset 4px 0 0 var(--red); }

.passcard {
  margin-top: 18px;
  padding: 20px;
  background: linear-gradient(135deg, var(--gold-soft) 0%, var(--cream-2) 100%);
  border-radius: var(--clay-r-md);
  box-shadow: var(--clay-shadow);
}
.passcard h3 {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 600; font-size: 17px;
  margin: 0 0 6px; color: var(--navy);
}
.passcard p { margin: 0 0 12px; font-size: 13px; color: var(--navy-2); }
.passcard .creds {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 15px;
  font-weight: 600;
  padding: 12px 14px;
  background: #fff;
  border-radius: var(--clay-r-sm);
  color: var(--navy);
  word-break: break-all;
  user-select: all;
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
  font-style: italic;
  font-family: Georgia, serif;
  color: var(--muted);
}

/* Audit log */
.audit-list { list-style: none; padding: 0; margin: 0; }
.audit-list li {
  padding: 10px 14px;
  background: var(--cream);
  border-radius: var(--clay-r-sm);
  margin-bottom: 6px;
  font-size: 13px;
  display: grid; grid-template-columns: 140px 1fr auto; gap: 12px;
  align-items: center;
}
.audit-list li .ts {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: var(--muted);
}
.audit-list li .actor {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; color: var(--navy);
}
@media (max-width: 600px) {
  .audit-list li { grid-template-columns: 1fr; gap: 4px; }
}
`;

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&#39;" }[c]!)
  );
}

function permLabel(k: keyof Permissions): string {
  const labels: Record<string, string> = {
    hub: "Desk (landing)",
    blake: "Blake live",
    progress: "Tracker",
    roadmap: "Roadmap",
    followups: "Follow-ups",
    deals: "Deals",
    weekly: "Weekly Docket",
    priorities: "Priority",
    markets: "Markets",
    insights: "Insights",
    websites: "Websites",
    dashboard: "Ops Dashboard",
    can_view_credentials: "View credentials",
    can_view_costs: "View costs",
    can_view_blake_calls: "Listen to Blake calls",
    can_export_data: "Export data (CSV)",
    can_add_users: "Add users",
    can_remove_users: "Remove users",
  };
  return labels[k] || k;
}

function permGroup(k: keyof Permissions): "tabs" | "sensitive" | "admin" {
  if (k === "can_view_credentials" || k === "can_view_costs" || k === "can_view_blake_calls" || k === "can_export_data") return "sensitive";
  if (k === "can_add_users" || k === "can_remove_users") return "admin";
  return "tabs";
}

function renderPermGrid(perms: Permissions, opts: { disabledAdmin?: boolean } = {}): string {
  const groups: Record<string, Array<keyof Permissions>> = { tabs: [], sensitive: [], admin: [] };
  for (const k of PERM_KEYS) groups[permGroup(k)].push(k);

  const renderTile = (k: keyof Permissions) => {
    const checked = perms[k] ? "checked" : "";
    const disabled = opts.disabledAdmin && permGroup(k) === "admin" ? "disabled" : "";
    return `
      <label class="perm-tile">
        <span>
          <span class="perm-label">${escapeHtml(permLabel(k))}</span>
          <span class="perm-key">${escapeHtml(k)}</span>
        </span>
        <input type="checkbox" name="perm:${escapeHtml(k)}" value="1" ${checked} ${disabled}>
      </label>
    `;
  };

  return `
    <div class="perm-section">
      <h3>Tab visibility</h3>
      <div class="perm-grid">${groups.tabs.map(renderTile).join("")}</div>
    </div>
    <div class="perm-section">
      <h3>Sensitive surfaces</h3>
      <div class="perm-grid">${groups.sensitive.map(renderTile).join("")}</div>
    </div>
    <div class="perm-section">
      <h3>Admin powers ${opts.disabledAdmin ? "<span style=\"color:var(--muted);font-weight:400;font-family:'Inter',sans-serif;font-size:12px;font-style:italic;\">— employees can never hold these</span>" : ""}</h3>
      <div class="perm-grid">${groups.admin.map(renderTile).join("")}</div>
    </div>
  `;
}

export function parsePermsFromForm(form: FormData, role: Role): Permissions {
  const p = permsAllFalse();
  for (const k of PERM_KEYS) {
    if (form.get(`perm:${k}`)) (p as any)[k] = true;
  }
  // Always grant hub for any role.
  p.hub = true;
  return clampPermsForRole(role, p);
}

// =============================================================================
// HTML — page renderers
// =============================================================================

interface PageOpts {
  title: string;
  body: string;
  topNav: string;            // pass apgTopNav("admin") from caller
  flash?: { kind?: "success" | "error" | "info"; text: string };
}

export function adminPageHtml(opts: PageOpts): string {
  const flash = opts.flash
    ? `<div class="alert ${opts.flash.kind || ""}">${escapeHtml(opts.flash.text)}</div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>APG — ${escapeHtml(opts.title)}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta name="theme-color" content="#0A1F44">
<style>${ADMIN_CSS}</style>
</head>
<body>
${opts.topNav}
<main class="adm-main">
${flash}
${opts.body}
</main>
</body>
</html>`;
}

// ---- /admin/users — list view ----
export function renderUsersListBody(users: User[], me: User, recent: AuditEntry[]): string {
  const visible = me.role === "ceo" ? users : users.filter((u) => u.role === "employee" || u.email === me.email);

  const rows = visible.length === 0
    ? `<tr><td colspan="5"><div class="empty-state">No users yet. Click "Invite a teammate" above to add one.</div></td></tr>`
    : visible.map((u) => {
        const canEdit = me.role === "ceo" || (me.role === "manager" && u.role === "employee");
        const canRemove = canEdit && u.email !== me.email;
        const tplLabel = u.template ? escapeHtml(u.template) : (u.role === "employee" ? "<em style='color:var(--muted)'>custom</em>" : "<em style='color:var(--muted)'>all</em>");
        const last = u.last_login
          ? new Date(u.last_login).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : "<em style='color:var(--muted)'>never</em>";
        return `
          <tr>
            <td>
              <div class="user-name">${escapeHtml(u.name)}</div>
              <div class="user-email">${escapeHtml(u.email)}</div>
            </td>
            <td><span class="role-badge role-${u.role}">${u.role}</span></td>
            <td>${tplLabel}</td>
            <td><span style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;color:var(--muted)">${last}</span></td>
            <td>
              <div class="row-actions">
                ${canEdit ? `<a href="/admin/users/${encodeURIComponent(u.email)}">Edit</a>` : ""}
                ${canRemove ? `<a href="/admin/users/${encodeURIComponent(u.email)}/delete" class="danger" onclick="return confirm('Remove ${escapeHtml(u.name)}? This cannot be undone.')">Remove</a>` : ""}
              </div>
            </td>
          </tr>
        `;
      }).join("");

  const auditHtml = recent.length === 0 ? `<div class="empty-state">No recent activity.</div>` : `
    <ul class="audit-list">
      ${recent.slice(0, 12).map((a) => `
        <li>
          <span class="ts">${escapeHtml(new Date(a.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</span>
          <span><strong>${escapeHtml(a.action)}</strong>${a.target ? ` &middot; ${escapeHtml(a.target)}` : ""}</span>
          <span class="actor">${escapeHtml(a.actor)}</span>
        </li>
      `).join("")}
    </ul>
  `;

  return `
    <header class="adm-hero">
      <div>
        <h1>The <em>team</em>.</h1>
        <p>${visible.length} ${visible.length === 1 ? "user" : "users"} with access. ${me.role === "ceo" ? "You can manage everyone." : "You can add and manage employees."}</p>
      </div>
      <div class="btn-row">
        <a class="btn btn-primary" href="/admin/users/new">+ Invite a teammate</a>
        <a class="btn" href="/admin/templates">Templates</a>
        <a class="btn" href="/me">My profile</a>
      </div>
    </header>

    <section class="card">
      <h2>Active users</h2>
      <p class="sub">Click a name to edit role + per-tab permissions, or remove access.</p>
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>Person</th><th>Role</th><th>Template</th><th>Last login</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2>Recent activity</h2>
      <p class="sub">90-day audit log — user creates, deletes, permission changes.</p>
      ${auditHtml}
    </section>
  `;
}

// ---- /admin/users/new — create form ----
export function renderUsersNewBody(me: User, templates: AdminTemplate[], flash?: { kind?: "success" | "error" | "info"; text: string; newPassword?: string; newEmail?: string }): string {
  const canPickCeo = me.role === "ceo";
  const canPickManager = me.role === "ceo";

  const defaultRole: Role = me.role === "ceo" ? "manager" : "employee";
  const defaultPerms = defaultPermsForRole(defaultRole);

  const tplOptions = templates.map((t) => `<option value="${escapeHtml(t.slug)}">${escapeHtml(t.name)} — ${escapeHtml(t.description)}</option>`).join("");

  const passcard = flash?.newPassword && flash?.newEmail ? `
    <div class="passcard">
      <h3>One-time password for ${escapeHtml(flash.newEmail)}</h3>
      <p>Share this with the new user securely (1Password, signal, or in person). It is not stored in plaintext anywhere — you cannot retrieve it later. After first login, they can rotate via the profile page.</p>
      <div class="creds">${escapeHtml(flash.newPassword)}</div>
    </div>
  ` : "";

  return `
    <header class="adm-hero">
      <div>
        <h1>Invite a <em>teammate</em>.</h1>
        <p>Pick a role, drop a template if it's an employee, fine-tune per-tab access if needed.</p>
      </div>
      <div class="btn-row">
        <a class="btn" href="/admin/users">&larr; Back to users</a>
      </div>
    </header>

    ${passcard}

    <section class="card">
      <h2>New user</h2>
      <p class="sub">A strong passphrase is generated automatically; you'll see it once after submit.</p>
      <form class="adm-form" method="POST" action="/admin/users/new">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
          <div class="field">
            <label for="name">Full name</label>
            <input type="text" id="name" name="name" required placeholder="e.g. Kebrina Richards">
          </div>
          <div class="field">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required placeholder="name@company.com">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
          <div class="field">
            <label for="role">Role</label>
            <select id="role" name="role">
              ${canPickCeo ? `<option value="ceo">CEO — full access + can manage anyone</option>` : ""}
              ${canPickManager ? `<option value="manager" selected>Manager — full access + can manage employees</option>` : ""}
              <option value="employee" ${me.role === "manager" ? "selected" : ""}>Employee — permission-gated per tab</option>
            </select>
          </div>
          <div class="field">
            <label for="template">Template (employees only)</label>
            <select id="template" name="template">
              <option value="">— Custom permissions —</option>
              ${tplOptions}
            </select>
          </div>
        </div>

        ${renderPermGrid(defaultPerms, { disabledAdmin: false })}

        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:10px;">
          <a class="btn" href="/admin/users">Cancel</a>
          <button type="submit" class="btn btn-primary">Create user &amp; generate password</button>
        </div>
      </form>
    </section>

    <script>
      // Auto-populate permissions when role or template changes. Pure DOM —
      // the actual permission set is re-validated server-side on submit.
      (function () {
        const tplData = ${JSON.stringify(templates.reduce((acc, t) => { acc[t.slug] = t.permissions; return acc; }, {} as Record<string, Permissions>))};
        const roleDefaults = {
          ceo: ${JSON.stringify(defaultPermsForRole("ceo"))},
          manager: ${JSON.stringify(defaultPermsForRole("manager"))},
          employee: ${JSON.stringify(defaultPermsForRole("employee"))},
        };
        const roleSel = document.getElementById("role");
        const tplSel = document.getElementById("template");
        function apply(perms) {
          for (const cb of document.querySelectorAll('input[name^="perm:"]')) {
            const key = cb.name.slice("perm:".length);
            cb.checked = Boolean(perms[key]);
          }
        }
        roleSel.addEventListener("change", () => {
          const r = roleSel.value;
          if (r !== "employee") { apply(roleDefaults[r]); tplSel.value = ""; }
          else { apply(roleDefaults.employee); }
        });
        tplSel.addEventListener("change", () => {
          const slug = tplSel.value;
          if (slug && tplData[slug]) apply(tplData[slug]);
        });
      })();
    </script>
  `;
}

// ---- /admin/users/<email> — edit form ----
export function renderUserEditBody(me: User, target: User, templates: AdminTemplate[], flash?: { kind?: "success" | "error" | "info"; text: string; newPassword?: string }): string {
  const tplOptions = templates.map((t) => `<option value="${escapeHtml(t.slug)}" ${target.template === t.slug ? "selected" : ""}>${escapeHtml(t.name)} — ${escapeHtml(t.description)}</option>`).join("");

  const passcard = flash?.newPassword ? `
    <div class="passcard">
      <h3>New password for ${escapeHtml(target.email)}</h3>
      <p>Share this with the user securely. It replaces their previous password effective immediately.</p>
      <div class="creds">${escapeHtml(flash.newPassword)}</div>
    </div>
  ` : "";

  return `
    <header class="adm-hero">
      <div>
        <h1>Edit <em>${escapeHtml(target.name)}</em>.</h1>
        <p>${escapeHtml(target.email)} &middot; created ${escapeHtml(new Date(target.created_at).toLocaleDateString("en-US"))}${target.last_login ? ` &middot; last login ${escapeHtml(new Date(target.last_login).toLocaleDateString("en-US"))}` : ""}</p>
      </div>
      <div class="btn-row">
        <a class="btn" href="/admin/users">&larr; Back to users</a>
      </div>
    </header>

    ${passcard}

    <section class="card">
      <h2>Profile + permissions</h2>
      <p class="sub">Changes audit-log automatically.</p>
      <form class="adm-form" method="POST" action="/admin/users/${encodeURIComponent(target.email)}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
          <div class="field">
            <label>Full name</label>
            <input type="text" name="name" required value="${escapeHtml(target.name)}">
          </div>
          <div class="field">
            <label>Email</label>
            <input type="email" name="email" value="${escapeHtml(target.email)}" readonly style="opacity:0.7;cursor:not-allowed;">
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
          <div class="field">
            <label>Role</label>
            <select name="role" ${me.role === "manager" && target.role !== "employee" ? "disabled" : ""}>
              ${me.role === "ceo" ? `<option value="ceo" ${target.role === "ceo" ? "selected" : ""}>CEO</option>` : ""}
              ${me.role === "ceo" ? `<option value="manager" ${target.role === "manager" ? "selected" : ""}>Manager</option>` : ""}
              <option value="employee" ${target.role === "employee" ? "selected" : ""}>Employee</option>
            </select>
          </div>
          <div class="field">
            <label>Template</label>
            <select name="template">
              <option value="">— Custom permissions —</option>
              ${tplOptions}
            </select>
          </div>
        </div>

        ${renderPermGrid(target.permissions, { disabledAdmin: target.role === "employee" })}

        <div style="display:flex;justify-content:space-between;gap:10px;margin-top:10px;flex-wrap:wrap;">
          <button type="submit" name="action" value="regen_password" class="btn">Regenerate password</button>
          <div style="display:flex;gap:10px;">
            <a class="btn" href="/admin/users">Cancel</a>
            <button type="submit" name="action" value="save" class="btn btn-primary">Save changes</button>
          </div>
        </div>
      </form>
    </section>
  `;
}

// ---- /admin/templates — list / edit templates ----
export function renderTemplatesBody(templates: AdminTemplate[]): string {
  const rows = templates.map((t) => {
    const grants = PERM_KEYS.filter((k) => t.permissions[k]).length;
    return `
      <tr>
        <td>
          <div class="user-name">${escapeHtml(t.name)}</div>
          <div class="user-email">${escapeHtml(t.slug)}${t.builtin ? " &middot; builtin" : ""}</div>
        </td>
        <td><span style="font-size:13px;color:var(--muted)">${escapeHtml(t.description)}</span></td>
        <td><span style="font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;color:var(--navy);font-weight:600">${grants} grants</span></td>
      </tr>
    `;
  }).join("");

  return `
    <header class="adm-hero">
      <div>
        <h1>Permission <em>templates</em>.</h1>
        <p>Preset bundles so inviting an employee doesn't mean checking 12 boxes by hand.</p>
      </div>
      <div class="btn-row">
        <a class="btn" href="/admin/users">&larr; Back to users</a>
      </div>
    </header>
    <section class="card">
      <h2>Available templates</h2>
      <p class="sub">Built-in templates seed the dropdown on the invite form. To add a custom template, contact the operator (live edit coming next session).</p>
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>Template</th><th>Description</th><th>Grants</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

// ---- /me — my profile ----
export function renderMeBody(me: User): string {
  const grants = PERM_KEYS.filter((k) => me.permissions[k]);
  const denials = PERM_KEYS.filter((k) => !me.permissions[k]);

  return `
    <header class="adm-hero">
      <div>
        <h1>${escapeHtml(me.name.split(" ")[0])}, <em>your access</em>.</h1>
        <p>${escapeHtml(me.email)} &middot; ${me.role.toUpperCase()}${me.last_login ? ` &middot; last login ${escapeHtml(new Date(me.last_login).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}` : ""}</p>
      </div>
      <div class="btn-row">
        <a class="btn" href="/">&larr; Dashboard</a>
        ${me.permissions.can_add_users ? `<a class="btn btn-primary" href="/admin/users">Manage team</a>` : ""}
      </div>
    </header>

    <section class="card">
      <h2>What you can see</h2>
      <p class="sub">Permissions granted to your account. Ask your manager to adjust if anything's missing.</p>
      <div class="perm-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
        ${grants.map((k) => `<div class="perm-tile" style="cursor:default"><span><span class="perm-label">${escapeHtml(permLabel(k))}</span><span class="perm-key">${escapeHtml(k)}</span></span><span style="color:var(--green);font-weight:700;font-size:18px;">&#10003;</span></div>`).join("")}
      </div>
      ${denials.length ? `
      <h2 style="margin-top:24px">Restricted</h2>
      <p class="sub">These surfaces are hidden from your nav and return 403 if visited directly.</p>
      <div class="perm-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
        ${denials.map((k) => `<div class="perm-tile" style="cursor:default;opacity:0.55"><span><span class="perm-label">${escapeHtml(permLabel(k))}</span><span class="perm-key">${escapeHtml(k)}</span></span><span style="color:var(--muted);font-weight:700;font-size:18px;">&times;</span></div>`).join("")}
      </div>
      ` : ""}
    </section>

    <section class="card">
      <h2>Rotate password</h2>
      <p class="sub">Generate a new passphrase. Old password stops working immediately.</p>
      <form class="adm-form" method="POST" action="/me/rotate-password">
        <button type="submit" class="btn btn-primary">Regenerate my password</button>
      </form>
    </section>
  `;
}

// ---- /login — multi-user editorial login form ----
export function renderLoginV2Html(opts: { error?: string; next?: string; info?: string } = {}): string {
  const errorBlock = opts.error
    ? `<div class="alert error">${escapeHtml(opts.error)}</div>`
    : "";
  const infoBlock = opts.info
    ? `<div class="alert success">${escapeHtml(opts.info)}</div>`
    : "";
  const nextField = opts.next
    ? `<input type="hidden" name="next" value="${escapeHtml(opts.next)}">`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>APG — Sign in</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta name="theme-color" content="#0A1F44">
<style>
${ADMIN_CSS}
body { display: flex; align-items: center; justify-content: center; padding: 24px; }
.login-card {
  width: 100%; max-width: 460px;
  background: #fff;
  border-radius: var(--clay-r-lg);
  box-shadow: var(--clay-shadow);
  padding: 40px 36px;
  position: relative;
}
.login-card::before {
  content: ""; position: absolute; left: 0; top: 0;
  width: 120px; height: 4px; background: var(--gold);
  border-radius: var(--clay-r-lg) 0 var(--clay-r-lg) 0;
}
.brandrow {
  display: flex; justify-content: space-between; align-items: baseline;
  font: 600 10px/1 'Inter', sans-serif;
  text-transform: uppercase; letter-spacing: 0.18em;
  color: var(--muted); margin-bottom: 24px;
}
.brandrow .right { color: var(--navy); }
.mark { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
.mark img { width: 36px; height: 36px; }
.mark span {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 600; font-size: 16px; color: var(--navy);
  letter-spacing: -0.005em;
}
.mark span em { color: var(--gold); font-style: italic; font-weight: 500; }
.login-card h1 {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: 36px; line-height: 1.05;
  letter-spacing: -0.02em;
  margin: 0 0 8px; color: var(--navy);
}
.login-card h1 em { color: var(--gold); font-style: italic; font-weight: 500; }
.login-card .dek {
  font-family: Georgia, serif; font-style: italic;
  font-size: 15px; color: var(--muted);
  margin: 0 0 24px;
}
.login-card form { display: grid; gap: 12px; }
.login-card .field input {
  font-family: 'Inter', sans-serif;
  font-size: 16px;
  padding: 13px 14px;
}
.login-card .submit-row {
  margin-top: 14px;
  display: flex; gap: 10px;
}
.login-card .submit-row .btn { flex: 1; }
.login-card .foot {
  margin-top: 26px;
  padding-top: 18px;
  border-top: 1px solid var(--rule);
  display: flex; justify-content: space-between; align-items: center;
  font: 600 10px/1 'Inter', sans-serif;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--muted);
}
.login-card .foot .stamp {
  background: var(--gold); color: var(--navy);
  padding: 4px 10px;
  border-radius: var(--clay-r-sm);
  box-shadow: var(--clay-shadow);
}
@media (max-width: 480px) {
  .login-card { padding: 28px 22px; }
  .login-card h1 { font-size: 28px; }
}
</style>
</head>
<body>
<div class="login-card">
  <div class="brandrow">
    <span>The Operations Console</span>
    <span class="right">Vol. III &middot; No. 2</span>
  </div>
  <div class="mark">
    <img src="/favicon.svg" alt="">
    <span>At<em>o</em>m Property Group</span>
  </div>
  <h1>Please <em>sign in</em>.</h1>
  <p class="dek">Closed circulation. Acquisitions, dispositions, voice &mdash; routed from here.</p>
  ${errorBlock}
  ${infoBlock}
  <form method="POST" action="/login">
    ${nextField}
    <div class="field">
      <label for="email">Email</label>
      <input type="text" id="email" name="email" autocomplete="username" autofocus required placeholder="you@company.com">
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required>
    </div>
    <div class="submit-row">
      <button type="submit" class="btn btn-primary">Sign in &rarr;</button>
    </div>
    <div style="margin-top:10px; font: 500 13px/1 'Inter',sans-serif; text-align:right;">
      <a href="/forgot" style="color: var(--muted); text-decoration: underline; text-underline-offset: 3px;">Forgot password?</a>
    </div>
  </form>
  <div class="foot">
    <span>Authorized personnel only</span>
    <span class="stamp">Internal</span>
  </div>
</div>
</body>
</html>`;
}

// ---- /forgot — public password-reset request form ----
export function renderForgotHtml(opts: { error?: string; submitted?: boolean; email?: string } = {}): string {
  const errorBlock = opts.error
    ? `<div class="alert error">${escapeHtml(opts.error)}</div>`
    : "";
  const body = opts.submitted
    ? `<h1>Request <em>received</em>.</h1>
       <p class="dek">A manager has been notified. They will issue a fresh password and share it with you over Slack or text. If you don't hear back within a business day, ping Adam or Kebrina directly.</p>
       <div class="submit-row"><a class="btn btn-primary" href="/login">Back to sign in &rarr;</a></div>`
    : `<h1>Forgot your <em>password</em>?</h1>
       <p class="dek">Submit your email and a manager will issue a new one out-of-band. No email is sent &mdash; reset is delivered over your usual channel.</p>
       ${errorBlock}
       <form method="POST" action="/forgot">
         <div class="field">
           <label for="email">Email</label>
           <input type="email" id="email" name="email" autocomplete="email" autofocus required placeholder="you@company.com" value="${escapeHtml(opts.email || "")}">
         </div>
         <div class="submit-row">
           <button type="submit" class="btn btn-primary">Request reset &rarr;</button>
         </div>
         <div style="margin-top:10px; font: 500 13px/1 'Inter',sans-serif; text-align:right;">
           <a href="/login" style="color: var(--muted); text-decoration: underline; text-underline-offset: 3px;">Back to sign in</a>
         </div>
       </form>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>APG — Forgot password</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta name="theme-color" content="#0A1F44">
<style>
${ADMIN_CSS}
body { display: flex; align-items: center; justify-content: center; padding: 24px; }
.login-card {
  width: 100%; max-width: 460px;
  background: #fff;
  border-radius: var(--clay-r-lg);
  box-shadow: var(--clay-shadow);
  padding: 40px 36px;
  position: relative;
}
.login-card::before {
  content: ""; position: absolute; left: 0; top: 0;
  width: 120px; height: 4px; background: var(--gold);
  border-radius: var(--clay-r-lg) 0 var(--clay-r-lg) 0;
}
.mark { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
.mark img { width: 36px; height: 36px; }
.mark span {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 600; font-size: 16px; color: var(--navy);
}
.mark span em { color: var(--gold); font-style: italic; font-weight: 500; }
.login-card h1 {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: 32px; line-height: 1.1;
  letter-spacing: -0.02em;
  margin: 0 0 8px; color: var(--navy);
}
.login-card h1 em { color: var(--gold); font-style: italic; font-weight: 500; }
.login-card .dek {
  font-family: Georgia, serif; font-style: italic;
  font-size: 15px; color: var(--muted);
  margin: 0 0 22px;
}
.login-card form { display: grid; gap: 12px; }
.login-card .submit-row { margin-top: 14px; display: flex; gap: 10px; }
.login-card .submit-row .btn { flex: 1; }
</style>
</head>
<body>
<div class="login-card">
  <div class="mark">
    <img src="/favicon.svg" alt="">
    <span>At<em>o</em>m Property Group</span>
  </div>
  ${body}
</div>
</body>
</html>`;
}

// ---- /admin/password-requests — manager queue ----
export function renderPasswordRequestsBody(
  requests: Array<PasswordRequest & { key: string }>,
  flash?: { kind: "success" | "error"; text: string; resetEmail?: string; resetPassword?: string },
): string {
  const pending = requests.filter((r) => r.status === "pending");
  const recent = requests.filter((r) => r.status !== "pending").slice(0, 25);

  const flashBlock = flash?.resetPassword
    ? `<div class="alert success" style="font-family: 'JetBrains Mono', monospace; word-break: break-all;">
         <strong>New password for ${escapeHtml(flash.resetEmail || "")}:</strong><br>
         <span style="font-size: 18px;">${escapeHtml(flash.resetPassword)}</span><br>
         <small style="font-family: 'Inter',sans-serif; font-style: italic;">Copy now &mdash; this is shown ONCE. Share with the user over Slack or text.</small>
       </div>`
    : flash
      ? `<div class="alert ${flash.kind}">${escapeHtml(flash.text)}</div>`
      : "";

  const pendingRows = pending.length === 0
    ? `<tr><td colspan="4" style="font-style: italic; color: var(--muted); text-align: center; padding: 20px;">No pending password requests.</td></tr>`
    : pending.map((r) => `
        <tr>
          <td>${escapeHtml(r.email)}</td>
          <td style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted);">${escapeHtml(r.ts)}</td>
          <td style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted);">${escapeHtml(r.ip)}</td>
          <td>
            <form method="POST" action="/admin/password-requests" style="display: inline;">
              <input type="hidden" name="action" value="reset">
              <input type="hidden" name="key" value="${escapeHtml(r.key)}">
              <button type="submit" class="btn btn-primary" style="padding: 6px 14px;">Reset</button>
            </form>
            <form method="POST" action="/admin/password-requests" style="display: inline; margin-left: 6px;">
              <input type="hidden" name="action" value="ignore">
              <input type="hidden" name="key" value="${escapeHtml(r.key)}">
              <button type="submit" class="btn" style="padding: 6px 14px;">Ignore</button>
            </form>
          </td>
        </tr>`).join("");

  const recentRows = recent.length === 0
    ? `<tr><td colspan="4" style="font-style: italic; color: var(--muted); text-align: center; padding: 20px;">No recent activity.</td></tr>`
    : recent.map((r) => `
        <tr>
          <td>${escapeHtml(r.email)}</td>
          <td style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted);">${escapeHtml(r.ts)}</td>
          <td>${escapeHtml(r.status)}</td>
          <td style="font-size: 12px; color: var(--muted);">${escapeHtml(r.fulfilled_by || "")} ${r.fulfilled_at ? escapeHtml("@ " + r.fulfilled_at) : ""}</td>
        </tr>`).join("");

  return `
    <header class="adm-hero">
      <div>
        <h1>Password <em>requests</em>.</h1>
        <p>Users who submitted /forgot. Click Reset to generate a fresh passphrase &mdash; shown ONCE on screen. Share it with the user over Slack or text.</p>
      </div>
    </header>
    ${flashBlock}
    <section style="margin-top: 24px;">
      <h2 style="font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 22px; color: var(--navy); margin: 0 0 12px;">Pending</h2>
      <table class="adm-table">
        <thead><tr><th>Email</th><th>Requested</th><th>IP</th><th>Actions</th></tr></thead>
        <tbody>${pendingRows}</tbody>
      </table>
    </section>
    <section style="margin-top: 32px;">
      <h2 style="font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 22px; color: var(--navy); margin: 0 0 12px;">Recent</h2>
      <table class="adm-table">
        <thead><tr><th>Email</th><th>Requested</th><th>Status</th><th>Resolved by</th></tr></thead>
        <tbody>${recentRows}</tbody>
      </table>
    </section>`;
}
