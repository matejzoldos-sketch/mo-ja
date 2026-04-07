import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import {
  computeSessionToken,
  DASHBOARD_SESSION_COOKIE,
  getDashboardSecret,
} from "@/lib/dashboardAuth";

export const dynamic = "force-dynamic";

function safeEqualPassword(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const secret = getDashboardSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "Heslo nie je nastavené (DASHBOARD_PASSWORD)." },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const input =
    typeof body === "object" &&
    body !== null &&
    typeof (body as { password?: unknown }).password === "string"
      ? (body as { password: string }).password
      : "";

  if (!safeEqualPassword(input, secret)) {
    return NextResponse.json({ error: "Nesprávne heslo" }, { status: 401 });
  }

  const token = await computeSessionToken(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DASHBOARD_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
