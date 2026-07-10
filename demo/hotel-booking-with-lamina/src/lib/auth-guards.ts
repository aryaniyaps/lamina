import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function requireHotelStaff() {
  const session = await getSession();
  if (!session || session.role !== UserRole.HOTEL_STAFF) {
    redirect("/hotel/sign-in");
  }
  return session;
}

export async function requireAdmin() {
  const session = await getSession();
  if (
    !session ||
    (session.role !== UserRole.PLATFORM_ADMIN && session.role !== UserRole.SUPPORT_AGENT)
  ) {
    redirect("/admin/sign-in");
  }
  return session;
}

export async function getHotelContext(userId: string) {
  const staff = await db.hotelStaff.findUnique({
    where: { userId },
    include: {
      hotelAccount: {
        include: { properties: { include: { roomTypes: true, cancellationPolicy: true } } },
      },
    },
  });
  if (!staff) return null;
  return staff;
}

export async function getHotelPropertyIds(userId: string): Promise<string[]> {
  const ctx = await getHotelContext(userId);
  return ctx?.hotelAccount.properties.map((p) => p.id) ?? [];
}
