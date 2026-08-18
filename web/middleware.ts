import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getDashboardSecret,
  isAuthorizedNextRequest,
  isOpenDashboardAllowed,
} from "@/lib/dashboardAuth";
import { jsonNoStoreHeaders } from "@/lib/apiJsonNoStore";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/login") {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const secret = getDashboardSecret();
  if (!secret) {
    if (isOpenDashboardAllowed()) {
      return NextResponse.next();
    }
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Dashboard nie je nakonfigurovaný." },
        { status: 503, headers: jsonNoStoreHeaders }
      );
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (await isAuthorizedNextRequest(request)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: jsonNoStoreHeaders }
    );
  }

  const login = new URL("/login", request.url);
  const nextPath = pathname + request.nextUrl.search;
  if (nextPath.startsWith("/") && !nextPath.startsWith("//")) {
    login.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
