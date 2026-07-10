"use server";

import { db } from "@/lib/db";
import { requirePartner, requireAuth } from "@/lib/session";
import { slugify } from "@/lib/utils";
import { DEFAULT_CANCELLATION_POLICY } from "@/lib/dates";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDays, startOfDay } from "date-fns";

export async function getOwnerHotel(userId: string) {
  return db.hotel.findFirst({
    where: { ownerId: userId },
    include: { roomTypes: true },
  });
}

const hotelSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(20),
  address: z.string().min(5),
  city: z.string().min(2),
  state: z.string().optional(),
  country: z.string().min(2),
  postalCode: z.string().optional(),
  checkInTime: z.string().default("15:00"),
  checkOutTime: z.string().default("11:00"),
  cancellationPolicy: z.string().optional(),
  amenities: z.string().optional(),
  photos: z.string().optional(),
});

export async function upsertHotelAction(formData: FormData): Promise<void> {
  const session = await requirePartner();
  const parsed = hotelSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    address: formData.get("address"),
    city: formData.get("city"),
    state: formData.get("state"),
    country: formData.get("country"),
    postalCode: formData.get("postalCode"),
    checkInTime: formData.get("checkInTime"),
    checkOutTime: formData.get("checkOutTime"),
    cancellationPolicy: formData.get("cancellationPolicy"),
    amenities: formData.get("amenities"),
    photos: formData.get("photos"),
  });

  if (!parsed.success) return;

  const amenities = parsed.data.amenities
    ? parsed.data.amenities.split(",").map((a) => a.trim()).filter(Boolean)
    : [];
  const photos = parsed.data.photos
    ? parsed.data.photos.split("\n").map((p) => p.trim()).filter(Boolean)
    : [];

  const existing = await getOwnerHotel(session.user.id);
  const slug = existing?.slug ?? slugify(parsed.data.name);

  const data = {
    ...parsed.data,
    amenities,
    photos,
    cancellationPolicy: parsed.data.cancellationPolicy ?? DEFAULT_CANCELLATION_POLICY,
    slug,
  };

  if (existing) {
    await db.hotel.update({ where: { id: existing.id }, data });
  } else {
    await db.hotel.create({
      data: { ...data, ownerId: session.user.id, status: "DRAFT" },
    });
  }

  revalidatePath("/partner");
  revalidatePath("/partner/hotel");
}

export async function publishHotelAction(): Promise<void> {
  const session = await requirePartner();
  const hotel = await getOwnerHotel(session.user.id);
  if (!hotel || hotel.roomTypes.length === 0) return;

  await db.hotel.update({
    where: { id: hotel.id },
    data: { status: "PUBLISHED" },
  });

  revalidatePath("/partner");
  revalidatePath("/search");
}

const roomSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2),
  description: z.string().min(10),
  capacity: z.coerce.number().min(1).max(10),
  beds: z.string().min(2),
  basePrice: z.coerce.number().min(1000),
  totalRooms: z.coerce.number().min(1).max(50),
  amenities: z.string().optional(),
  photos: z.string().optional(),
});

export async function upsertRoomAction(formData: FormData): Promise<void> {
  const session = await requirePartner();
  const hotel = await getOwnerHotel(session.user.id);
  if (!hotel) return;

  const parsed = roomSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    description: formData.get("description"),
    capacity: formData.get("capacity"),
    beds: formData.get("beds"),
    basePrice: formData.get("basePrice"),
    totalRooms: formData.get("totalRooms"),
    amenities: formData.get("amenities"),
    photos: formData.get("photos"),
  });

  if (!parsed.success) return;

  const amenities = parsed.data.amenities
    ? parsed.data.amenities.split(",").map((a) => a.trim()).filter(Boolean)
    : [];
  const photos = parsed.data.photos
    ? parsed.data.photos.split("\n").map((p) => p.trim()).filter(Boolean)
    : [];

  const { id, ...roomData } = parsed.data;

  if (id) {
    await db.roomType.update({
      where: { id, hotelId: hotel.id },
      data: { ...roomData, amenities, photos },
    });
  } else {
    await db.roomType.create({
      data: { ...roomData, amenities, photos, hotelId: hotel.id },
    });
  }

  revalidatePath("/partner/rooms");
}

export async function updateInventoryAction(formData: FormData): Promise<void> {
  const session = await requirePartner();
  const hotel = await getOwnerHotel(session.user.id);
  if (!hotel) return;

  const roomTypeId = formData.get("roomTypeId") as string;
  const date = formData.get("date") as string;
  const available = Number(formData.get("available"));
  const priceOverride = formData.get("priceOverride")
    ? Number(formData.get("priceOverride"))
    : null;

  const room = await db.roomType.findFirst({
    where: { id: roomTypeId, hotelId: hotel.id },
  });
  if (!room) return;

  await db.inventoryDay.upsert({
    where: {
      roomTypeId_date: {
        roomTypeId,
        date: startOfDay(new Date(date)),
      },
    },
    create: {
      roomTypeId,
      date: startOfDay(new Date(date)),
      available,
      priceOverride,
    },
    update: { available, priceOverride },
  });

  revalidatePath("/partner/calendar");
}

export async function updateBookingStatusAction(bookingId: string, status: string): Promise<void> {
  const session = await requirePartner();
  const hotel = await getOwnerHotel(session.user.id);
  if (!hotel) return;

  const booking = await db.booking.findFirst({
    where: { id: bookingId, hotelId: hotel.id },
  });
  if (!booking) return;

  await db.booking.update({
    where: { id: bookingId },
    data: { status: status as "CONFIRMED" | "COMPLETED" | "NO_SHOW" },
  });

  revalidatePath("/partner/reservations");
}

export async function sendMessageAction(formData: FormData): Promise<void> {
  const session = await requireAuth();
  const threadId = formData.get("threadId") as string;
  const content = formData.get("content") as string;
  if (!content?.trim()) return;

  const thread = await db.messageThread.findUnique({
    where: { id: threadId },
    include: { booking: { include: { hotel: true, guest: true } } },
  });
  if (!thread) return;

  const isGuest = thread.booking.guestId === session.user.id;
  const isOwner = thread.booking.hotel.ownerId === session.user.id;
  if (!isGuest && !isOwner) return;

  await db.message.create({
    data: { threadId, senderId: session.user.id, content: content.trim() },
  });

  const recipientId = isGuest ? thread.booking.hotel.ownerId : thread.booking.guestId;
  const { createNotification } = await import("@/lib/notifications");
  await createNotification({
    userId: recipientId,
    type: "NEW_MESSAGE",
    title: "New message",
    body: content.slice(0, 100),
    link: isGuest ? `/partner/messages` : `/trips/${thread.bookingId}`,
  });

  revalidatePath(`/trips/${thread.bookingId}`);
  revalidatePath("/partner/messages");
}

export async function respondToReviewAction(formData: FormData): Promise<void> {
  const session = await requirePartner();
  const hotel = await getOwnerHotel(session.user.id);
  if (!hotel) return;

  const reviewId = formData.get("reviewId") as string;
  const response = formData.get("response") as string;

  const review = await db.review.findFirst({
    where: { id: reviewId, hotelId: hotel.id },
  });
  if (!review) return;

  await db.review.update({
    where: { id: reviewId },
    data: { response, respondedAt: new Date() },
  });

  revalidatePath("/partner/reviews");
}

export async function seedInventoryForRoom(roomTypeId: string, days = 90) {
  const room = await db.roomType.findUnique({ where: { id: roomTypeId } });
  if (!room) return;

  const today = startOfDay(new Date());
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    await db.inventoryDay.upsert({
      where: { roomTypeId_date: { roomTypeId, date } },
      create: { roomTypeId, date, available: room.totalRooms },
      update: {},
    });
  }
}
