"use server";

import { revalidatePath } from "next/cache";
import {
  BookingStatus,
  PaymentStatus,
  PropertyStatus,
  RefundStatus,
  ReviewStatus,
  TrustReportStatus,
  UserStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { UserRole } from "@prisma/client";
import { sendPropertyStatusEmail } from "@/lib/notifications";
import { createRefund } from "@/lib/stripe";

async function audit(adminId: string, adminEmail: string, action: string, targetType: string, targetId: string, reason?: string) {
  await db.adminAuditLog.create({
    data: { adminId, adminEmail, action, targetType, targetId, reason },
  });
}

export async function approvePropertyAction(propertyId: string) {
  const admin = await requireRole(UserRole.PLATFORM_ADMIN, UserRole.SUPPORT_AGENT);
  await db.property.update({
    where: { id: propertyId },
    data: { status: PropertyStatus.LIVE, rejectionReason: null, changeRequest: null },
  });
  await sendPropertyStatusEmail(propertyId, "property_approved");
  await audit(admin.id, admin.email, "approve_property", "property", propertyId);
  revalidatePath("/admin/approvals");
  return { success: true };
}

export async function rejectPropertyAction(propertyId: string, reason: string) {
  const admin = await requireRole(UserRole.PLATFORM_ADMIN, UserRole.SUPPORT_AGENT);
  await db.property.update({
    where: { id: propertyId },
    data: { status: PropertyStatus.REJECTED, rejectionReason: reason },
  });
  await sendPropertyStatusEmail(propertyId, "property_rejected", reason);
  await audit(admin.id, admin.email, "reject_property", "property", propertyId, reason);
  revalidatePath("/admin/approvals");
  return { success: true };
}

export async function requestPropertyChangesAction(propertyId: string, notes: string) {
  const admin = await requireRole(UserRole.PLATFORM_ADMIN, UserRole.SUPPORT_AGENT);
  await db.property.update({
    where: { id: propertyId },
    data: { changeRequest: notes },
  });
  await sendPropertyStatusEmail(propertyId, "property_change_requested", notes);
  await audit(admin.id, admin.email, "request_changes", "property", propertyId, notes);
  revalidatePath("/admin/approvals");
  return { success: true };
}

export async function suspendUserAction(userId: string, reason: string) {
  const admin = await requireRole(UserRole.PLATFORM_ADMIN);
  await db.user.update({ where: { id: userId }, data: { status: UserStatus.SUSPENDED } });
  await audit(admin.id, admin.email, "suspend_user", "user", userId, reason);
  revalidatePath("/admin/users");
  return { success: true };
}

export async function reinstateUserAction(userId: string) {
  const admin = await requireRole(UserRole.PLATFORM_ADMIN);
  await db.user.update({ where: { id: userId }, data: { status: UserStatus.ACTIVE } });
  await audit(admin.id, admin.email, "reinstate_user", "user", userId);
  revalidatePath("/admin/users");
  return { success: true };
}

export async function suspendPropertyAction(propertyId: string, reason: string) {
  const admin = await requireRole(UserRole.PLATFORM_ADMIN);
  await db.property.update({ where: { id: propertyId }, data: { status: PropertyStatus.PAUSED } });
  await audit(admin.id, admin.email, "suspend_property", "property", propertyId, reason);
  revalidatePath("/admin/properties");
  return { success: true };
}

export async function adminCancelBookingAction(bookingId: string, reason: string, refundCents: number) {
  const admin = await requireRole(UserRole.PLATFORM_ADMIN, UserRole.SUPPORT_AGENT);
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true },
  });
  if (!booking?.payment) return { error: "Not found" };

  await createRefund(booking.payment.stripePaymentIntentId ?? "", refundCents);
  await db.refund.create({
    data: {
      paymentId: booking.payment.id,
      bookingId,
      amountCents: refundCents,
      reason: `Admin override: ${reason}`,
      status: RefundStatus.SUCCEEDED,
    },
  });
  await db.payment.update({
    where: { id: booking.payment.id },
    data: { status: refundCents >= booking.totalCents ? PaymentStatus.REFUNDED_FULL : PaymentStatus.REFUNDED_PARTIAL },
  });
  await db.booking.update({
    where: { id: bookingId },
    data: { status: BookingStatus.CANCELLED_BY_HOTEL },
  });
  await audit(admin.id, admin.email, "admin_cancel_booking", "booking", bookingId, reason);
  revalidatePath("/admin/bookings");
  return { success: true };
}

export async function resolveTrustReportAction(reportId: string, action: string, notes: string) {
  const admin = await requireRole(UserRole.PLATFORM_ADMIN, UserRole.SUPPORT_AGENT);
  await db.trustReport.update({
    where: { id: reportId },
    data: {
      status: action === "dismiss" ? TrustReportStatus.DISMISSED : TrustReportStatus.ACTION_TAKEN,
      adminNotes: notes,
    },
  });
  await audit(admin.id, admin.email, "resolve_trust_report", "trust_report", reportId, notes);
  revalidatePath("/admin/trust");
  return { success: true };
}

export async function removeReviewAction(reviewId: string, reason: string) {
  const admin = await requireRole(UserRole.PLATFORM_ADMIN, UserRole.SUPPORT_AGENT);
  await db.review.update({ where: { id: reviewId }, data: { status: ReviewStatus.REMOVED } });
  await audit(admin.id, admin.email, "remove_review", "review", reviewId, reason);
  revalidatePath("/admin/reviews");
  return { success: true };
}

export async function updateCommissionRateAction(rate: number) {
  const admin = await requireRole(UserRole.PLATFORM_ADMIN);
  await db.platformConfig.upsert({
    where: { id: "default" },
    create: { commissionRate: rate },
    update: { commissionRate: rate },
  });
  await audit(admin.id, admin.email, "update_commission", "config", "default", String(rate));
  revalidatePath("/admin/settings");
  return { success: true };
}

export async function resolveTicketAction(ticketId: string) {
  const admin = await requireRole(UserRole.PLATFORM_ADMIN, UserRole.SUPPORT_AGENT);
  await db.supportTicket.update({
    where: { id: ticketId },
    data: { status: "RESOLVED" },
  });
  await audit(admin.id, admin.email, "resolve_ticket", "support_ticket", ticketId);
  revalidatePath("/admin/tickets");
  return { success: true };
}
