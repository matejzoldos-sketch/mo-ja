import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  getDashboardSecret,
  isAuthorizedNextRequest,
} from "@/lib/dashboardAuth";

export async function middleware(request: NextRequest) {
  if (!getDashboardSecret()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (pathname === "/login") {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  if (await isAuthorizedNextRequest(request)) {
    return NextResponse.next();
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
