"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BookingStatus,
  PaymentStatus,
  RefundStatus,
  ReviewStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { createBookingDraft, confirmBookingPayment, finalizeBooking } from "@/lib/booking";
import { calculateRefundCents, isReviewWindowOpen, type PolicySnapshot } from "@/lib/cancellation";
import { createRefund } from "@/lib/stripe";
import { sendCancellationEmail } from "@/lib/notifications";
import { startOfDay } from "@/lib/utils";

export async function createBookingAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/sign-in?redirect=/checkout");

  const bookingId = String(formData.get("bookingId") ?? "");

  try {
    if (bookingId) {
      const booking = await finalizeBooking({
        bookingId,
        userId: session.id,
        guestName: String(formData.get("guestName")),
        guestEmail: String(formData.get("guestEmail")),
        guestPhone: String(formData.get("guestPhone") || "") || undefined,
        specialRequests: String(formData.get("specialRequests") || "") || undefined,
      });
      redirect(`/confirmation/${booking.confirmationCode}`);
    }

    const result = await createBookingDraft({
      userId: session.id,
      propertyId: String(formData.get("propertyId")),
      roomTypeId: String(formData.get("roomTypeId")),
      quantity: Number(formData.get("quantity") || 1),
      checkIn: startOfDay(new Date(String(formData.get("checkIn")))),
      checkOut: startOfDay(new Date(String(formData.get("checkOut")))),
      guestCount: Number(formData.get("guestCount") || 1),
      guestName: String(formData.get("guestName")),
      guestEmail: String(formData.get("guestEmail")),
      guestPhone: String(formData.get("guestPhone") || "") || undefined,
      specialRequests: String(formData.get("specialRequests") || "") || undefined,
    });

    await confirmBookingPayment(result.booking.id);
    redirect(`/confirmation/${result.booking.confirmationCode}`);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Booking failed" };
  }
}

export async function cancelBookingAction(bookingId: string) {
  const session = await getSession();
  if (!session) return { error: "Not signed in" };

  const booking = await db.booking.findFirst({
    where: { id: bookingId, userId: session.id },
    include: { payment: true },
  });
  if (!booking || booking.status !== BookingStatus.CONFIRMED) {
    return { error: "Cannot cancel this booking" };
  }

  const snapshot = JSON.parse(booking.policySnapshot) as PolicySnapshot;
  const { refundCents } = calculateRefundCents(booking.totalCents, snapshot);

  if (booking.payment) {
    await createRefund(booking.payment.stripePaymentIntentId ?? "", refundCents);
    await db.refund.create({
      data: {
        paymentId: booking.payment.id,
        bookingId: booking.id,
        amountCents: refundCents,
        reason: "Cancelled by traveler",
        status: RefundStatus.SUCCEEDED,
      },
    });
    await db.payment.update({
      where: { id: booking.payment.id },
      data: {
        status: refundCents >= booking.totalCents ? PaymentStatus.REFUNDED_FULL : PaymentStatus.REFUNDED_PARTIAL,
      },
    });
  }

  await db.booking.update({
    where: { id: bookingId },
    data: { status: BookingStatus.CANCELLED_BY_TRAVELER },
  });

  await sendCancellationEmail(bookingId, refundCents);
  revalidatePath("/trips");
  return { success: true, refundCents };
}

export async function submitReviewAction(formData: FormData) {
  const session = await getSession();
  if (!session) return { error: "Not signed in" };

  const bookingId = String(formData.get("bookingId"));
  const booking = await db.booking.findFirst({
    where: { id: bookingId, userId: session.id, status: BookingStatus.COMPLETED },
  });
  if (!booking) return { error: "Booking not eligible for review" };
  if (!isReviewWindowOpen(booking.checkOutDate)) return { error: "Review window closed" };

  const existing = await db.review.findUnique({ where: { bookingId } });
  if (existing) return { error: "Review already submitted" };

  const bodyText = String(formData.get("bodyText"));
  if (bodyText.length < 20) return { error: "Review must be at least 20 characters" };

  const overallRating = Number(formData.get("overallRating"));

  await db.review.create({
    data: {
      bookingId,
      userId: session.id,
      propertyId: booking.propertyId,
      overallRating,
      bodyText,
      status: ReviewStatus.PUBLISHED,
    },
  });

  const reviews = await db.review.findMany({
    where: { propertyId: booking.propertyId, status: ReviewStatus.PUBLISHED },
  });
  const avg = reviews.reduce((s, r) => s + r.overallRating, overallRating) / (reviews.length + 1);
  await db.property.update({
    where: { id: booking.propertyId },
    data: { averageRating: avg, reviewCount: reviews.length + 1 },
  });

  revalidatePath("/trips");
  return { success: true };
}

export async function getRefundPreview(bookingId: string) {
  const session = await getSession();
  if (!session) return null;

  const booking = await db.booking.findFirst({
    where: { id: bookingId, userId: session.id },
  });
  if (!booking) return null;

  const snapshot = JSON.parse(booking.policySnapshot) as PolicySnapshot;
  return calculateRefundCents(booking.totalCents, snapshot);
}
