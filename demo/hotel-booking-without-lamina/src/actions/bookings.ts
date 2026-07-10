"use server";

import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import {
  createBookingDraft,
  startCheckout,
  confirmBooking,
  cancelBooking,
} from "@/lib/bookings";
import { parseISO } from "date-fns";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const bookingSchema = z.object({
  roomTypeId: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  guests: z.coerce.number().min(1).max(6),
  guestName: z.string().min(2),
  guestEmail: z.string().email(),
  guestPhone: z.string().optional(),
  specialRequests: z.string().optional(),
});

export async function createBookingAction(formData: FormData): Promise<void> {
  const session = await requireAuth("/sign-in?redirect=/search");

  const parsed = bookingSchema.safeParse({
    roomTypeId: formData.get("roomTypeId"),
    checkIn: formData.get("checkIn"),
    checkOut: formData.get("checkOut"),
    guests: formData.get("guests"),
    guestName: formData.get("guestName"),
    guestEmail: formData.get("guestEmail"),
    guestPhone: formData.get("guestPhone"),
    specialRequests: formData.get("specialRequests"),
  });

  if (!parsed.success) redirect("/search?error=booking");

  try {
    const booking = await createBookingDraft({
      guestId: session.user.id,
      ...parsed.data,
      checkIn: parseISO(parsed.data.checkIn),
      checkOut: parseISO(parsed.data.checkOut),
      idempotencyKey: `${session.user.id}-${parsed.data.roomTypeId}-${parsed.data.checkIn}`,
    });

    const checkout = await startCheckout(booking.id);

    if (checkout.simulate) {
      await confirmBooking(booking.id);
      redirect(`/bookings/${booking.id}/confirmation`);
    }

    if (checkout.url) {
      redirect(checkout.url);
    }

    redirect("/search?error=checkout");
  } catch (e) {
    const message = e instanceof Error ? e.message : "Booking failed";
    redirect(`/search?error=${encodeURIComponent(message)}`);
  }
}

export async function simulatePaymentAction(bookingId: string): Promise<void> {
  const session = await requireAuth();
  const booking = await db.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.guestId !== session.user.id) return;

  await confirmBooking(bookingId);
  revalidatePath("/trips");
  redirect(`/bookings/${bookingId}/confirmation`);
}

export async function cancelBookingAction(bookingId: string): Promise<void> {
  const session = await requireAuth();
  try {
    await cancelBooking(bookingId, session.user.id);
    revalidatePath("/trips");
    revalidatePath(`/trips/${bookingId}`);
  } catch {
    // silently fail - user sees unchanged state
  }
}
