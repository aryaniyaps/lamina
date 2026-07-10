"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  CancellationTemplate,
  HotelAccountStatus,
  PropertyStatus,
  TicketCategory,
  TicketStatus,
  TrustReportStatus,
  UserRole,
} from "@prisma/client";
import { db } from "@/lib/db";
import { getSession, requireRole } from "@/lib/session";
import { CANCELLATION_TEMPLATES } from "@/lib/constants";
import { slugify, parseJsonArray } from "@/lib/utils";
import { ensureInventoryBlocks } from "@/lib/inventory";
import { sendPropertyStatusEmail } from "@/lib/notifications";

export async function savePropertyDraftAction(formData: FormData) {
  const session = await requireRole(UserRole.HOTEL_STAFF);
  const staff = await db.hotelStaff.findUnique({
    where: { userId: session.id },
    include: { hotelAccount: true },
  });
  if (!staff) throw new Error("Hotel account not found");

  const propertyId = formData.get("propertyId") as string | null;
  const name = String(formData.get("name"));
  const data = {
    name,
    slug: slugify(name),
    description: String(formData.get("description")),
    addressLine1: String(formData.get("addressLine1")),
    city: String(formData.get("city")),
    state: String(formData.get("state")),
    zip: String(formData.get("zip")),
    checkInTime: String(formData.get("checkInTime") || "15:00"),
    checkOutTime: String(formData.get("checkOutTime") || "11:00"),
    houseRules: String(formData.get("houseRules") || ""),
    photos: JSON.stringify(formData.getAll("photos").filter(Boolean).length
      ? formData.getAll("photos").map(String)
      : parseJsonArray(String(formData.get("existingPhotos") || "[]"))),
    amenities: JSON.stringify(formData.getAll("amenities").map(String)),
  };

  if (propertyId) {
    await db.property.update({ where: { id: propertyId }, data });
    revalidatePath(`/hotel/property/${propertyId}`);
    return { propertyId };
  }

  const property = await db.property.create({
    data: {
      ...data,
      hotelAccountId: staff.hotelAccountId,
      status: PropertyStatus.DRAFT,
    },
  });
  redirect(`/hotel/onboarding?propertyId=${property.id}&step=rooms`);
}

export async function saveRoomTypeAction(formData: FormData) {
  await requireRole(UserRole.HOTEL_STAFF);
  const propertyId = String(formData.get("propertyId"));
  const roomId = formData.get("roomId") as string | null;

  const data = {
    name: String(formData.get("name")),
    description: String(formData.get("description")),
    maxOccupancy: Number(formData.get("maxOccupancy")),
    bedConfiguration: String(formData.get("bedConfiguration")),
    baseRateCents: Math.round(Number(formData.get("baseRate")) * 100),
    totalInventoryCount: Number(formData.get("totalInventoryCount")),
    photos: JSON.stringify([String(formData.get("photo") || "")].filter(Boolean)),
  };

  if (roomId) {
    await db.roomType.update({ where: { id: roomId }, data });
  } else {
    await db.roomType.create({ data: { ...data, propertyId } });
  }
  revalidatePath("/hotel/onboarding");
  return { success: true };
}

export async function setCancellationPolicyAction(formData: FormData) {
  await requireRole(UserRole.HOTEL_STAFF);
  const propertyId = String(formData.get("propertyId"));
  const template = formData.get("template") as CancellationTemplate;
  const desc = CANCELLATION_TEMPLATES[template].description;

  await db.cancellationPolicy.upsert({
    where: { propertyId },
    create: { propertyId, template, description: desc },
    update: { template, description: desc },
  });
  return { success: true };
}

export async function completeStripeConnectAction() {
  const session = await requireRole(UserRole.HOTEL_STAFF);
  const staff = await db.hotelStaff.findUnique({ where: { userId: session.id } });
  if (!staff) throw new Error("No hotel account");

  await db.hotelAccount.update({
    where: { id: staff.hotelAccountId },
    data: {
      stripeConnectComplete: true,
      stripeConnectId: `acct_demo_${staff.hotelAccountId.slice(0, 8)}`,
      status: HotelAccountStatus.ACTIVE,
    },
  });
  return { success: true };
}

export async function submitPropertyForReviewAction(propertyId: string) {
  const session = await requireRole(UserRole.HOTEL_STAFF);
  const staff = await db.hotelStaff.findUnique({
    where: { userId: session.id },
    include: { hotelAccount: true },
  });
  if (!staff) throw new Error("No hotel account");

  const property = await db.property.findFirst({
    where: { id: propertyId, hotelAccountId: staff.hotelAccountId },
    include: { roomTypes: true, cancellationPolicy: true },
  });
  if (!property) throw new Error("Property not found");
  if (!staff.hotelAccount.stripeConnectComplete) {
    throw new Error("Complete Stripe Connect first");
  }

  const photos = parseJsonArray(property.photos);
  if (photos.length < 5) throw new Error("Add at least 5 photos");
  if (property.roomTypes.length < 1) throw new Error("Add at least one room type");
  if (!property.cancellationPolicy) throw new Error("Select a cancellation policy");
  if (!property.city || !property.state) throw new Error("US address required");

  await db.property.update({
    where: { id: propertyId },
    data: { status: PropertyStatus.PENDING_REVIEW },
  });
  await sendPropertyStatusEmail(propertyId, "property_submitted_for_review");
  revalidatePath("/hotel");
  return { success: true };
}

export async function updateInventoryAction(formData: FormData) {
  await requireRole(UserRole.HOTEL_STAFF);
  const roomTypeId = String(formData.get("roomTypeId"));
  const date = new Date(String(formData.get("date")));
  const availableCount = Number(formData.get("availableCount"));
  const rateCents = Math.round(Number(formData.get("rate")) * 100);

  await db.inventoryBlock.upsert({
    where: { roomTypeId_date: { roomTypeId, date } },
    create: { roomTypeId, date, availableCount, rateCents },
    update: { availableCount, rateCents, version: { increment: 1 } },
  });
  revalidatePath("/hotel");
  return { success: true };
}

export async function markCheckedInAction(bookingId: string) {
  await requireRole(UserRole.HOTEL_STAFF);
  await db.booking.update({
    where: { id: bookingId },
    data: { status: "CHECKED_IN" },
  });
  revalidatePath("/hotel/reservations");
  return { success: true };
}

export async function respondToReviewAction(formData: FormData) {
  await requireRole(UserRole.HOTEL_STAFF);
  const reviewId = String(formData.get("reviewId"));
  const response = String(formData.get("response")).slice(0, 500);
  await db.review.update({ where: { id: reviewId }, data: { hotelResponse: response } });
  revalidatePath("/hotel/reviews");
  return { success: true };
}

export async function createSupportTicketAction(formData: FormData) {
  const session = await getSession();
  const category = formData.get("category") as TicketCategory;
  await db.supportTicket.create({
    data: {
      userId: session?.id,
      category,
      subject: String(formData.get("subject")),
      messages: JSON.stringify([
        { from: session?.email ?? "guest", body: String(formData.get("message")), at: new Date().toISOString() },
      ]),
      status: TicketStatus.OPEN,
    },
  });
  return { success: true };
}

export async function createTrustReportAction(formData: FormData) {
  const session = await getSession();
  if (!session) return { error: "Sign in required" };

  await db.trustReport.create({
    data: {
      reporterId: session.id,
      propertyId: String(formData.get("propertyId") || "") || null,
      bookingId: String(formData.get("bookingId") || "") || null,
      reportType: String(formData.get("reportType")),
      description: String(formData.get("description")),
      status: TrustReportStatus.SUBMITTED,
    },
  });
  return { success: true };
}

export async function registerHotelAccountAction(formData: FormData) {
  const { registerUser, hashPassword } = await import("@/lib/auth");
  const { createSession } = await import("@/lib/session");

  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const name = String(formData.get("name"));
  const businessName = String(formData.get("businessName"));

  const user = await registerUser({
    email,
    password,
    name,
    role: UserRole.HOTEL_STAFF,
    verifyEmail: true,
  });

  const account = await db.hotelAccount.create({
    data: { legalBusinessName: businessName },
  });
  await db.hotelStaff.create({
    data: { userId: user.id, hotelAccountId: account.id, staffRole: "owner" },
  });

  const { loginUser } = await import("@/lib/auth");
  await loginUser(email, password);
  redirect("/hotel/onboarding");
}
