import { db } from "@/lib/db";
import {
  checkAvailability,
  calculateRoomPrice,
  decrementInventory,
  restoreInventory,
} from "@/lib/availability";
import { calculatePricing } from "@/lib/dates";
import { createNotification } from "@/lib/notifications";
import { sendBookingConfirmation, sendBookingCancellation } from "@/lib/email";
import { createCheckoutSession, createRefund, stripeEnabled } from "@/lib/stripe";
import {
  getCancellationTier,
  getRefundAmount,
  DEFAULT_CANCELLATION_POLICY,
} from "@/lib/dates";
import { formatCurrency, generateConfirmationCode } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { addHours, parseISO } from "date-fns";
import type { BookingStatus } from "@prisma/client";

export async function createBookingDraft({
  guestId,
  roomTypeId,
  checkIn,
  checkOut,
  guests,
  guestName,
  guestEmail,
  guestPhone,
  specialRequests,
  idempotencyKey,
}: {
  guestId: string;
  roomTypeId: string;
  checkIn: Date;
  checkOut: Date;
  guests: number;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  specialRequests?: string;
  idempotencyKey?: string;
}) {
  if (idempotencyKey) {
    const existing = await db.booking.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing;
  }

  const availability = await checkAvailability({
    roomTypeId,
    checkIn,
    checkOut,
    guests,
  });

  if (!availability.available) {
    throw new Error(availability.reason ?? "Not available");
  }

  const priceResult = await calculateRoomPrice({ roomTypeId, checkIn, checkOut });
  if (!priceResult) throw new Error("Could not calculate price");

  const pricing = calculatePricing(priceResult.subtotal);
  const roomType = availability.roomType!;
  const hotel = await db.hotel.findUnique({ where: { id: roomType.hotelId } });

  return db.booking.create({
    data: {
      guestId,
      hotelId: roomType.hotelId,
      roomTypeId,
      checkIn,
      checkOut,
      guests,
      guestName,
      guestEmail,
      guestPhone,
      specialRequests,
      idempotencyKey,
      confirmationCode: generateConfirmationCode(),
      subtotal: pricing.subtotal,
      taxAmount: pricing.taxAmount,
      serviceFee: pricing.serviceFee,
      totalAmount: pricing.totalAmount,
      cancellationPolicy: hotel?.cancellationPolicy ?? DEFAULT_CANCELLATION_POLICY,
      status: "PENDING_PAYMENT",
      expiresAt: addHours(new Date(), 1),
      payment: {
        create: {
          amount: pricing.totalAmount,
          status: "PENDING",
        },
      },
    },
    include: {
      hotel: true,
      roomType: true,
      payment: true,
    },
  });
}

export async function confirmBooking(bookingId: string, stripeData?: {
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
}) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { hotel: true, payment: true },
  });

  if (!booking) throw new Error("Booking not found");
  if (booking.status === "CONFIRMED") return booking;
  if (booking.status !== "PENDING_PAYMENT") {
    throw new Error("Booking cannot be confirmed");
  }

  await decrementInventory({
    roomTypeId: booking.roomTypeId,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
  });

  const confirmed = await db.$transaction(async (tx) => {
    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: "CONFIRMED",
        expiresAt: null,
        stripeSessionId: stripeData?.stripeSessionId,
        stripePaymentIntentId: stripeData?.stripePaymentIntentId,
      },
      include: { hotel: true, roomType: true },
    });

    await tx.payment.update({
      where: { bookingId },
      data: {
        status: "SUCCEEDED",
        stripeSessionId: stripeData?.stripeSessionId,
        stripePaymentIntentId: stripeData?.stripePaymentIntentId,
      },
    });

    if (!await tx.messageThread.findUnique({ where: { bookingId } })) {
      await tx.messageThread.create({ data: { bookingId } });
    }

    return updated;
  });

  await createNotification({
    userId: booking.guestId,
    type: "BOOKING_CONFIRMED",
    title: "Booking confirmed",
    body: `Your stay at ${booking.hotel.name} is confirmed.`,
    link: `/trips/${booking.id}`,
  });

  await createNotification({
    userId: booking.hotel.ownerId,
    type: "BOOKING_CONFIRMED",
    title: "New reservation",
    body: `${booking.guestName} booked ${booking.roomTypeId} for ${formatDate(booking.checkIn)}.`,
    link: `/partner/reservations/${booking.id}`,
  });

  await sendBookingConfirmation({
    to: booking.guestEmail,
    guestName: booking.guestName,
    hotelName: booking.hotel.name,
    confirmationCode: booking.confirmationCode,
    checkIn: formatDate(booking.checkIn),
    checkOut: formatDate(booking.checkOut),
    total: formatCurrency(booking.totalAmount),
  });

  return confirmed;
}

export async function startCheckout(bookingId: string) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { hotel: true },
  });

  if (!booking) throw new Error("Booking not found");
  if (booking.status !== "PENDING_PAYMENT") {
    throw new Error("Booking is not pending payment");
  }

  if (!stripeEnabled) {
    return { simulate: true, bookingId };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await createCheckoutSession({
    bookingId: booking.id,
    amount: booking.totalAmount,
    currency: booking.currency,
    customerEmail: booking.guestEmail,
    hotelName: booking.hotel.name,
    successUrl: `${appUrl}/bookings/${booking.id}/confirmation?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${appUrl}/hotels/${booking.hotel.slug}/book?cancelled=1`,
  });

  await db.booking.update({
    where: { id: bookingId },
    data: { stripeSessionId: session.id },
  });

  return { simulate: false, url: session.url };
}

export async function cancelBooking(bookingId: string, userId: string) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { hotel: true, payment: true },
  });

  if (!booking) throw new Error("Booking not found");
  if (booking.guestId !== userId) throw new Error("Unauthorized");
  if (booking.status === "CANCELLED") throw new Error("Already cancelled");
  if (booking.status !== "CONFIRMED" && booking.status !== "PENDING_PAYMENT") {
    throw new Error("Cannot cancel this booking");
  }

  const tier = getCancellationTier(booking.checkIn);
  const refundAmount = booking.status === "CONFIRMED"
    ? getRefundAmount(booking.totalAmount, tier)
    : booking.totalAmount;

  if (booking.status === "CONFIRMED") {
    await restoreInventory({
      roomTypeId: booking.roomTypeId,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
    });
  }

  if (
    refundAmount > 0 &&
    booking.stripePaymentIntentId &&
    stripeEnabled
  ) {
    await createRefund(booking.stripePaymentIntentId, refundAmount);
  }

  const cancelled = await db.$transaction(async (tx) => {
    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED" },
      include: { hotel: true },
    });

    if (booking.payment) {
      await tx.payment.update({
        where: { bookingId },
        data: {
          refundAmount,
          status:
            refundAmount === booking.totalAmount
              ? "REFUNDED"
              : refundAmount > 0
                ? "PARTIALLY_REFUNDED"
                : booking.payment.status,
        },
      });
    }

    return updated;
  });

  await createNotification({
    userId: booking.guestId,
    type: "BOOKING_CANCELLED",
    title: "Booking cancelled",
    body: `Your stay at ${booking.hotel.name} was cancelled.`,
    link: `/trips/${booking.id}`,
  });

  await sendBookingCancellation({
    to: booking.guestEmail,
    guestName: booking.guestName,
    hotelName: booking.hotel.name,
    confirmationCode: booking.confirmationCode,
    refundAmount: formatCurrency(refundAmount),
  });

  return { booking: cancelled, refundAmount, tier };
}

export async function cleanupExpiredBookings() {
  const expired = await db.booking.findMany({
    where: {
      status: "PENDING_PAYMENT",
      expiresAt: { lt: new Date() },
    },
  });

  for (const booking of expired) {
    await db.booking.update({
      where: { id: booking.id },
      data: { status: "CANCELLED" },
    });
  }

  return expired.length;
}

export async function getGuestBookings(userId: string, status?: BookingStatus) {
  return db.booking.findMany({
    where: {
      guestId: userId,
      ...(status ? { status } : {}),
    },
    include: {
      hotel: { select: { name: true, slug: true, photos: true, city: true } },
      roomType: { select: { name: true } },
      review: true,
    },
    orderBy: { checkIn: "desc" },
  });
}

export async function getHotelBookings(hotelId: string) {
  return db.booking.findMany({
    where: { hotelId, status: { not: "PENDING_PAYMENT" } },
    include: {
      guest: { select: { name: true, email: true } },
      roomType: { select: { name: true } },
    },
    orderBy: { checkIn: "asc" },
  });
}
