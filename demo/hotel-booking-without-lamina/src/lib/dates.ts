import { addDays, differenceInCalendarDays, format, isBefore, parseISO, startOfDay } from "date-fns";

export const TAX_RATE = 0.12;
export const SERVICE_FEE = 1500; // $15 in cents

export function getNights(checkIn: Date | string, checkOut: Date | string): number {
  const start = typeof checkIn === "string" ? parseISO(checkIn) : checkIn;
  const end = typeof checkOut === "string" ? parseISO(checkOut) : checkOut;
  return differenceInCalendarDays(end, start);
}

export function getStayDates(checkIn: Date | string, checkOut: Date | string): Date[] {
  const start = startOfDay(typeof checkIn === "string" ? parseISO(checkIn) : checkIn);
  const nights = getNights(checkIn, checkOut);
  return Array.from({ length: nights }, (_, i) => addDays(start, i));
}

export function formatDate(date: Date | string, pattern = "MMM d, yyyy"): string {
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, pattern);
}

export function formatDateRange(checkIn: Date | string, checkOut: Date | string): string {
  return `${formatDate(checkIn)} – ${formatDate(checkOut)}`;
}

export function isPastDate(date: Date | string): boolean {
  const d = typeof date === "string" ? parseISO(date) : date;
  return isBefore(startOfDay(d), startOfDay(new Date()));
}

export function calculatePricing(subtotal: number) {
  const taxAmount = Math.round(subtotal * TAX_RATE);
  const serviceFee = SERVICE_FEE;
  const totalAmount = subtotal + taxAmount + serviceFee;
  return { subtotal, taxAmount, serviceFee, totalAmount };
}

export type CancellationTier = "full" | "partial" | "none";

export function getCancellationTier(
  checkIn: Date | string,
  now = new Date()
): CancellationTier {
  const checkInDate = typeof checkIn === "string" ? parseISO(checkIn) : checkIn;
  const hoursUntilCheckIn =
    (checkInDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntilCheckIn >= 48) return "full";
  if (hoursUntilCheckIn > 0) return "partial";
  return "none";
}

export function getRefundAmount(
  totalAmount: number,
  tier: CancellationTier
): number {
  switch (tier) {
    case "full":
      return totalAmount;
    case "partial":
      return Math.round(totalAmount * 0.5);
    case "none":
      return 0;
  }
}

export function getCancellationMessage(tier: CancellationTier): string {
  switch (tier) {
    case "full":
      return "Free cancellation — full refund";
    case "partial":
      return "Late cancellation — 50% refund";
    case "none":
      return "No refund — check-in has passed or is within cancellation window";
  }
}

export const DEFAULT_CANCELLATION_POLICY =
  "Free cancellation up to 48 hours before check-in. Cancellations within 48 hours receive a 50% refund. No refund after check-in.";

export function getDefaultSearchDates() {
  const checkIn = addDays(startOfDay(new Date()), 7);
  const checkOut = addDays(checkIn, 3);
  return {
    checkIn: format(checkIn, "yyyy-MM-dd"),
    checkOut: format(checkOut, "yyyy-MM-dd"),
  };
}
