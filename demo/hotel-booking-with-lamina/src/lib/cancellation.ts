import { CancellationTemplate } from "@prisma/client";
import { addDays, subDays, subHours } from "date-fns";

export interface PolicySnapshot {
  template: CancellationTemplate;
  description: string;
  fullRefundUntil: string | null;
  partialRefundUntil: string | null;
  partialRefundPercent: number;
}

export function buildPolicySnapshot(
  template: CancellationTemplate,
  description: string,
  checkIn: Date,
): PolicySnapshot {
  const checkInDate = new Date(checkIn);
  checkInDate.setHours(15, 0, 0, 0);

  switch (template) {
    case "FLEXIBLE":
      return {
        template,
        description,
        fullRefundUntil: subHours(checkInDate, 24).toISOString(),
        partialRefundUntil: null,
        partialRefundPercent: 0,
      };
    case "MODERATE":
      return {
        template,
        description,
        fullRefundUntil: subDays(checkInDate, 5).toISOString(),
        partialRefundUntil: subHours(checkInDate, 24).toISOString(),
        partialRefundPercent: 50,
      };
    case "STRICT":
      return {
        template,
        description,
        fullRefundUntil: subDays(checkInDate, 7).toISOString(),
        partialRefundUntil: subDays(checkInDate, 7).toISOString(),
        partialRefundPercent: 50,
      };
    default:
      return {
        template: "FLEXIBLE",
        description,
        fullRefundUntil: subHours(checkInDate, 24).toISOString(),
        partialRefundUntil: null,
        partialRefundPercent: 0,
      };
  }
}

export function calculateRefundCents(
  totalCents: number,
  snapshot: PolicySnapshot,
  cancelledAt: Date = new Date(),
): { refundCents: number; explanation: string } {
  const now = cancelledAt;

  if (snapshot.fullRefundUntil && now <= new Date(snapshot.fullRefundUntil)) {
    return {
      refundCents: totalCents,
      explanation: "Full refund per your booking policy.",
    };
  }

  if (
    snapshot.partialRefundUntil &&
    snapshot.partialRefundPercent > 0 &&
    now <= new Date(snapshot.partialRefundUntil)
  ) {
    const refund = Math.round(totalCents * (snapshot.partialRefundPercent / 100));
    return {
      refundCents: refund,
      explanation: `${snapshot.partialRefundPercent}% refund per your booking policy.`,
    };
  }

  return {
    refundCents: 0,
    explanation: "No refund per your booking policy.",
  };
}

export function isReviewWindowOpen(checkOutDate: Date): boolean {
  const deadline = addDays(new Date(checkOutDate), 30);
  return new Date() <= deadline;
}
