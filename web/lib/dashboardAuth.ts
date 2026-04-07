import type { NextRequest } from "next/server";

export const DASHBOARD_SESSION_COOKIE = "dashboard_session";

const HMAC_SALT = "mo-ja-dashboard-session-v1";

/** Single secret: prefer DASHBOARD_PASSWORD, else legacy DASHBOARD_TOKEN (Bearer / login). */
export function getDashboardSecret(): string | undefined {
  const p = process.env.DASHBOARD_PASSWORD?.trim();
  if (p) return p;
  return process.env.DASHBOARD_TOKEN?.trim();
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

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function computeSessionToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(HMAC_SALT)
  );
  return Array.from(new Uint8Array(sig), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function validateSessionToken(
  token: string | undefined,
  secret: string
): Promise<boolean> {
  if (!token || !secret) return false;
  const expected = await computeSessionToken(secret);
  return timingSafeEqualHex(token, expected);
}

export async function isAuthorizedNextRequest(
  request: NextRequest
): Promise<boolean> {
  const secret = getDashboardSecret();
  if (!secret) return true;
  if (request.headers.get("authorization") === `Bearer ${secret}`) return true;
  const raw = request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
  return validateSessionToken(raw, secret);
}

export async function isAuthorizedRequest(request: Request): Promise<boolean> {
  const secret = getDashboardSecret();
  if (!secret) return true;
  if (request.headers.get("authorization") === `Bearer ${secret}`) return true;
  const raw = parseCookieHeader(
    request.headers.get("cookie"),
    DASHBOARD_SESSION_COOKIE
  );
  return validateSessionToken(raw, secret);
}
