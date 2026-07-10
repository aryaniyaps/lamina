import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;

  const protectedRoutes = ["/trips", "/account", "/partner", "/admin"];
  const isProtected = protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  if (isProtected && !isLoggedIn) {
    const signInUrl = new URL("/sign-in", req.nextUrl.origin);
    signInUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(signInUrl);
  }

  if (
    (pathname.startsWith("/partner") || pathname.startsWith("/admin")) &&
    isLoggedIn
  ) {
    const role = req.auth?.user?.role;
    const partnerRoles = ["HOTEL_OWNER", "HOTEL_STAFF", "ADMIN"];
    if (pathname.startsWith("/partner") && role && !partnerRoles.includes(role)) {
      return NextResponse.redirect(new URL("/", req.nextUrl.origin));
    }
    if (pathname.startsWith("/admin") && role !== "ADMIN") {
      return NextResponse.redirect(new URL("/", req.nextUrl.origin));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/trips/:path*", "/account/:path*", "/partner/:path*", "/admin/:path*"],
};
