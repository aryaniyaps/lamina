import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";

export async function requireAuth(redirectTo = "/sign-in") {
  const session = await auth();
  if (!session?.user) redirect(redirectTo);
  return session;
}

export async function requireRole(roles: UserRole | UserRole[], redirectTo = "/") {
  const session = await requireAuth();
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(session.user.role)) redirect(redirectTo);
  return session;
}

export async function requirePartner() {
  return requireRole(["HOTEL_OWNER", "HOTEL_STAFF", "ADMIN"], "/");
}

export async function requireAdmin() {
  return requireRole("ADMIN", "/");
}
