/**
 * auth-legacy.ts — backwards-compat verifier for the single-tenant
 * `apg_session` cookie used by the pre-multi-user dashboard.
 *
 * Mirrors the HMAC-SHA256 signed-cookie scheme in index.ts so admin-v2's
 * requireAuthV2 can accept old cookies as a synthetic "mido" Manager
 * session during the migration window. Once every legacy session has
 * naturally expired (~24h after deploy), this module can be removed.
 */

function b64urlEncode(bytes: Uint8Array | string): string {
  const arr =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(pad.replace(/-/g, "+").replace(/_/g, "/"));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(message)
  );
  return new Uint8Array(sig);
}

export async function verifyLegacySessionCookie(
  cookieValue: string,
  secret: string,
): Promise<{ ok: boolean; user?: string; reason?: string }> {
  if (!cookieValue || !cookieValue.includes(".")) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadB64, sigB64] = cookieValue.split(".");
  const expected = await hmacSha256(secret, payloadB64);
  const actual = b64urlDecode(sigB64);
  if (actual.length !== expected.length) return { ok: false, reason: "sig_length" };
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  if (diff !== 0) return { ok: false, reason: "sig_mismatch" };
  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  } catch {
    return { ok: false, reason: "payload_parse" };
  }
  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, user: payload.u };
}

// Exported so admin-v2 can also issue legacy cookies if we ever need to
// migrate someone backwards (not currently used, but keeps the API symmetric).
export async function signLegacySessionCookie(secret: string, user = "mido"): Promise<string> {
  const payload = JSON.stringify({
    u: user,
    exp: Math.floor(Date.now() / 1000) + 24 * 3600,
  });
  const payloadB64 = b64urlEncode(payload);
  const sig = await hmacSha256(secret, payloadB64);
  return `${payloadB64}.${b64urlEncode(sig)}`;
}
