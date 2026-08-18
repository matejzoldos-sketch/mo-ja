import type { NextRequest } from "next/server";

export const DASHBOARD_SESSION_COOKIE = "dashboard_session";

/** Cookie / server-side session TTL. */
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30;

const HMAC_SALT = "mo-ja-dashboard-session-v2";

/** Single secret: prefer DASHBOARD_PASSWORD, else legacy DASHBOARD_TOKEN (Bearer / login). */
export function getDashboardSecret(): string | undefined {
  const p = process.env.DASHBOARD_PASSWORD?.trim();
  if (p) return p;
  return process.env.DASHBOARD_TOKEN?.trim();
}

/** Local-only: dashboard without password. Never set in Production. */
export function isOpenDashboardAllowed(): boolean {
  return process.env.ALLOW_OPEN_DASHBOARD === "1";
}

export function parseCookieHeader(
  cookieHeader: string | null,
  name: string
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    const v = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return undefined;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return toHex(new Uint8Array(buf));
}

/** Constant-time compare of arbitrary strings via SHA-256 digests. */
export async function timingSafeStringEqual(
  a: string,
  b: string
): Promise<boolean> {
  return timingSafeEqualHex(await sha256Hex(a), await sha256Hex(b));
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toHex(new Uint8Array(sig));
}

export async function issueSessionToken(secret: string): Promise<string> {
  const issuedAt = Date.now().toString();
  const sig = await hmacHex(secret, `${HMAC_SALT}:${issuedAt}`);
  return `${issuedAt}.${sig}`;
}

export async function validateSessionToken(
  token: string | undefined,
  secret: string
): Promise<boolean> {
  if (!token || !secret) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
  const issuedAtRaw = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d{10,16}$/.test(issuedAtRaw) || !/^[0-9a-f]{64}$/.test(sig)) {
    return false;
  }
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return false;
  const ageMs = Date.now() - issuedAt;
  if (ageMs < -60_000 || ageMs > SESSION_MAX_AGE_SEC * 1000) return false;
  const expected = await hmacHex(secret, `${HMAC_SALT}:${issuedAtRaw}`);
  return timingSafeEqualHex(sig, expected);
}

async function hasValidAccess(
  secret: string | undefined,
  authorization: string | null,
  cookieValue: string | undefined
): Promise<boolean> {
  if (!secret) return isOpenDashboardAllowed();
  if (await timingSafeStringEqual(authorization ?? "", `Bearer ${secret}`)) {
    return true;
  }
  return validateSessionToken(cookieValue, secret);
}

export async function isAuthorizedNextRequest(
  request: NextRequest
): Promise<boolean> {
  return hasValidAccess(
    getDashboardSecret(),
    request.headers.get("authorization"),
    request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value
  );
}

export async function isAuthorizedRequest(request: Request): Promise<boolean> {
  return hasValidAccess(
    getDashboardSecret(),
    request.headers.get("authorization"),
    parseCookieHeader(request.headers.get("cookie"), DASHBOARD_SESSION_COOKIE)
  );
}
