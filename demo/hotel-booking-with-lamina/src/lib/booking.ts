import {
  BookingStatus,
  HoldStatus,
  PaymentStatus,
  PropertyStatus,
  UserStatus,
} from "@prisma/client";
import { addMinutes } from "date-fns";
import { db } from "./db";
import { HOLD_MINUTES, TAX_RATE_ESTIMATE } from "./constants";
import { buildPolicySnapshot } from "./cancellation";
import {
  checkAvailability,
  ensureInventoryBlocks,
  getNightlyRates,
} from "./inventory";
import { generateConfirmationCode } from "./utils";
import { createPaymentIntent, confirmMockPayment } from "./stripe";
import { sendBookingConfirmation } from "./notifications";
import { dateKey } from "./utils";

export async function createBookingDraft(input: {
  userId: string;
  propertyId: string;
  roomTypeId: string;
  quantity: number;
  checkIn: Date;
  checkOut: Date;
  guestCount: number;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  specialRequests?: string;
}) {
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user || user.status === UserStatus.SUSPENDED) {
    throw new Error("Account cannot book");
  }
  if (!user.emailVerifiedAt) {
    throw new Error("Please verify your email before booking");
  }

  const property = await db.property.findUnique({
    where: { id: input.propertyId },
    include: { cancellationPolicy: true, roomTypes: true },
  });
  if (!property || property.status !== PropertyStatus.LIVE) {
    throw new Error("Property not available");
  }

  const roomType = property.roomTypes.find((r) => r.id === input.roomTypeId);
  if (!roomType) throw new Error("Room type not found");
  if (input.guestCount > roomType.maxOccupancy * input.quantity) {
    throw new Error("Guest count exceeds room capacity");
  }

  await ensureInventoryBlocks(
    roomType.id,
    input.checkIn,
    input.checkOut,
    roomType.baseRateCents,
    roomType.totalInventoryCount,
  );

  const available = await checkAvailability(
    roomType.id,
    input.checkIn,
    input.checkOut,
    input.quantity,
    roomType.totalInventoryCount,
  );
  if (!available) throw new Error("Room no longer available for selected dates");

  const nights = getNightlyRates(
    roomType.id,
    input.checkIn,
    input.checkOut,
    roomType.baseRateCents,
  );
  const nightlyRates = await nights;
  const nightsCount = nightlyRates.length;
  const roomTotal = nightlyRates.reduce(
    (s, n) => s + n.rateCents * input.quantity,
    0,
  );
  const taxesFeesCents = Math.round(roomTotal * TAX_RATE_ESTIMATE);
  const config = await db.platformConfig.findUnique({ where: { id: "default" } });
  const commissionRate = config?.commissionRate ?? 0.15;
  const totalCents = roomTotal + taxesFeesCents;
  const commissionCents = Math.round(roomTotal * commissionRate);

  const policy = property.cancellationPolicy;
  const snapshot = policy
    ? buildPolicySnapshot(policy.template, policy.description, input.checkIn)
    : buildPolicySnapshot("FLEXIBLE", "Flexible cancellation", input.checkIn);

  const booking = await db.booking.create({
    data: {
      confirmationCode: generateConfirmationCode(),
      userId: input.userId,
      propertyId: input.propertyId,
      status: BookingStatus.PENDING_PAYMENT,
      checkInDate: input.checkIn,
      checkOutDate: input.checkOut,
      guestCount: input.guestCount,
      specialRequests: input.specialRequests,
      roomTotalCents: roomTotal,
      taxesFeesCents,
      totalCents,
      commissionCents,
      policySnapshot: JSON.stringify(snapshot),
      guestName: input.guestName,
      guestEmail: input.guestEmail,
      guestPhone: input.guestPhone,
      lines: {
        create: {
          roomTypeId: roomType.id,
          quantity: input.quantity,
          nights: nightsCount,
          ratePerNightCents: Math.round(roomTotal / (nightsCount * input.quantity)),
        },
      },
      hold: {
        create: {
          roomTypeId: roomType.id,
          status: HoldStatus.ACTIVE,
          quantity: input.quantity,
          nights: JSON.stringify(nightlyRates.map((n) => dateKey(n.date))),
          expiresAt: addMinutes(new Date(), HOLD_MINUTES),
        },
      },
    },
    include: { hold: true },
  });

  const { id: paymentIntentId, clientSecret } = await createPaymentIntent(
    totalCents,
    { bookingId: booking.id },
  );

  await db.payment.create({
    data: {
      bookingId: booking.id,
      stripePaymentIntentId: paymentIntentId,
      amountCents: totalCents,
      status: PaymentStatus.PENDING,
    },
  });

  return { booking, clientSecret, paymentIntentId };
}

export async function confirmBookingPayment(bookingId: string) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true, hold: true },
  });
  if (!booking?.payment) throw new Error("Booking not found");

  if (booking.status === BookingStatus.CONFIRMED) return booking;

  if (booking.hold && booking.hold.expiresAt < new Date() && booking.hold.status === HoldStatus.ACTIVE) {
    await db.inventoryHold.update({
      where: { id: booking.hold.id },
      data: { status: HoldStatus.EXPIRED },
    });
    throw new Error("Hold expired — please try again");
  }

  const piId = booking.payment.stripePaymentIntentId ?? "";
  const ok = await confirmMockPayment(piId);
  if (!ok) throw new Error("Payment failed");

  const [updated] = await db.$transaction([
    db.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CONFIRMED },
    }),
    db.payment.update({
      where: { id: booking.payment.id },
      data: { status: PaymentStatus.SUCCEEDED, capturedAt: new Date() },
    }),
    ...(booking.hold
      ? [
          db.inventoryHold.update({
            where: { id: booking.hold.id },
            data: { status: HoldStatus.CONVERTED },
          }),
        ]
      : []),
  ]);

  await sendBookingConfirmation(bookingId);
  return updated;
}

export async function expireStaleHolds() {
  const stale = await db.inventoryHold.findMany({
    where: { status: HoldStatus.ACTIVE, expiresAt: { lt: new Date() } },
  });
  for (const hold of stale) {
    await db.inventoryHold.update({
      where: { id: hold.id },
      data: { status: HoldStatus.EXPIRED },
    });
    await db.booking.updateMany({
      where: {
        id: hold.bookingId,
        status: { in: [BookingStatus.DRAFT, BookingStatus.PENDING_PAYMENT] },
      },
      data: { status: BookingStatus.PAYMENT_FAILED },
    });
  }
  return stale.length;
}

export async function completePastBookings() {
  const now = new Date();
  await db.booking.updateMany({
    where: {
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
      checkOutDate: { lt: now },
    },
    data: { status: BookingStatus.COMPLETED },
  });
}
