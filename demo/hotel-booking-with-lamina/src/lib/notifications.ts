import { db } from "./db";
import { NotificationStatus } from "@prisma/client";

export async function queueEmail(input: {
  userId?: string;
  templateId: string;
  recipient: string;
  subject: string;
  body: string;
}) {
  // In production, integrate SendGrid/SES. For dev, log and mark sent.
  console.log(`[EMAIL] ${input.templateId} → ${input.recipient}: ${input.subject}`);

  return db.notification.create({
    data: {
      userId: input.userId,
      templateId: input.templateId,
      recipient: input.recipient,
      subject: input.subject,
      body: input.body,
      status: NotificationStatus.SENT,
      sentAt: new Date(),
    },
  });
}

export async function sendBookingConfirmation(bookingId: string) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { user: true, property: true },
  });
  if (!booking) return;

  await queueEmail({
    userId: booking.userId,
    templateId: "booking_confirmation_traveler",
    recipient: booking.user.email,
    subject: `Booking confirmed — ${booking.confirmationCode}`,
    body: `Your stay at ${booking.property.name} is confirmed. Confirmation code: ${booking.confirmationCode}`,
  });
}

export async function sendCancellationEmail(bookingId: string, refundCents: number) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { user: true, property: true },
  });
  if (!booking) return;

  await queueEmail({
    userId: booking.userId,
    templateId: "cancellation_traveler",
    recipient: booking.user.email,
    subject: `Booking cancelled — ${booking.confirmationCode}`,
    body: `Your booking at ${booking.property.name} has been cancelled. Refund: $${(refundCents / 100).toFixed(2)}`,
  });
}

export async function sendPropertyStatusEmail(
  propertyId: string,
  templateId: string,
  extra?: string,
) {
  const property = await db.property.findUnique({
    where: { id: propertyId },
    include: { hotelAccount: { include: { staff: { include: { user: true } } } } },
  });
  if (!property) return;

  const staff = property.hotelAccount.staff[0]?.user;
  if (!staff) return;

  const subjects: Record<string, string> = {
    property_submitted_for_review: `Listing submitted — ${property.name}`,
    property_approved: `Listing approved — ${property.name} is live!`,
    property_rejected: `Listing needs attention — ${property.name}`,
    property_change_requested: `Changes requested — ${property.name}`,
  };

  await queueEmail({
    userId: staff.id,
    templateId,
    recipient: staff.email,
    subject: subjects[templateId] ?? `Update on ${property.name}`,
    body: extra ?? `Status update for ${property.name}.`,
  });
}
