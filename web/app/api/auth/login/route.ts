import { NextResponse } from "next/server";
import {
  DASHBOARD_SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  getDashboardSecret,
  issueSessionToken,
  timingSafeStringEqual,
} from "@/lib/dashboardAuth";
import {
  clearLoginFailures,
  clientIpFromRequest,
  loginRetryAfterSec,
  recordLoginFailure,
} from "@/lib/loginRateLimit";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = getDashboardSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "Dashboard nie je nakonfigurovaný." },
      { status: 503, headers: jsonNoStoreHeaders }
    );
  }

  const ip = clientIpFromRequest(request);
  const retryAfter = loginRetryAfterSec(ip);
  if (retryAfter != null) {
    return NextResponse.json(
      { error: "Príliš veľa pokusov. Skús neskôr." },
      {
        status: 429,
        headers: {
          ...jsonNoStoreHeaders,
          "Retry-After": String(retryAfter),
        },
      }
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

  if (!(await timingSafeStringEqual(input, secret))) {
    recordLoginFailure(ip);
    return NextResponse.json(
      { error: "Nesprávne heslo" },
      { status: 401, headers: jsonNoStoreHeaders }
    );
  }

  clearLoginFailures(ip);
  const token = await issueSessionToken(secret);
  const res = NextResponse.json({ ok: true }, { headers: jsonNoStoreHeaders });
  res.cookies.set(DASHBOARD_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}
