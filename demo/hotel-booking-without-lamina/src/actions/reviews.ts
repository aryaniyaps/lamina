"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const reviewSchema = z.object({
  bookingId: z.string(),
  rating: z.coerce.number().min(1).max(5),
  title: z.string().optional(),
  content: z.string().min(10),
});

export async function createReviewAction(formData: FormData): Promise<void> {
  const session = await requireAuth();
  const parsed = reviewSchema.safeParse({
    bookingId: formData.get("bookingId"),
    rating: formData.get("rating"),
    title: formData.get("title"),
    content: formData.get("content"),
  });

  if (!parsed.success) return;

  const booking = await db.booking.findUnique({
    where: { id: parsed.data.bookingId },
    include: { review: true },
  });

  if (!booking || booking.guestId !== session.user.id) return;
  if (booking.status !== "COMPLETED" && booking.status !== "CONFIRMED") return;
  if (booking.review) return;
  if (new Date() < booking.checkOut) return;

  await db.$transaction(async (tx) => {
    await tx.review.create({
      data: {
        hotelId: booking.hotelId,
        userId: session.user.id,
        bookingId: booking.id,
        rating: parsed.data.rating,
        title: parsed.data.title,
        content: parsed.data.content,
      },
    });

    const reviews = await tx.review.findMany({
      where: { hotelId: booking.hotelId },
      select: { rating: true },
    });
    const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;

    await tx.hotel.update({
      where: { id: booking.hotelId },
      data: { rating: avg, reviewCount: reviews.length },
    });
  });

  revalidatePath(`/trips/${booking.id}`);
}

const reportSchema = z.object({
  reason: z.string().min(3),
  description: z.string().optional(),
  hotelId: z.string().optional(),
  reviewId: z.string().optional(),
});

export async function createReportAction(formData: FormData): Promise<void> {
  const session = await requireAuth();
  const parsed = reportSchema.safeParse({
    reason: formData.get("reason"),
    description: formData.get("description"),
    hotelId: formData.get("hotelId") || undefined,
    reviewId: formData.get("reviewId") || undefined,
  });

  if (!parsed.success) return;

  await db.report.create({
    data: {
      reporterId: session.user.id,
      ...parsed.data,
    },
  });
}

const ticketSchema = z.object({
  email: z.string().email(),
  subject: z.string().min(3),
  message: z.string().min(10),
});

export async function createSupportTicketAction(formData: FormData): Promise<void> {
  const session = await authOptional();
  const parsed = ticketSchema.safeParse({
    email: formData.get("email"),
    subject: formData.get("subject"),
    message: formData.get("message"),
  });

  if (!parsed.success) return;

  await db.supportTicket.create({
    data: {
      userId: session?.user?.id,
      ...parsed.data,
    },
  });
}

async function authOptional() {
  const { auth } = await import("@/lib/auth");
  return auth();
}

export async function markNotificationsReadAction(): Promise<void> {
  const session = await requireAuth();
  const { markNotificationsRead } = await import("@/lib/notifications");
  await markNotificationsRead(session.user.id);
  revalidatePath("/account/notifications");
}
