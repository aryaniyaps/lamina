import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { BookingStatus } from "@prisma/client";
import { TravelerHeader } from "@/components/traveler-header";
import { Badge } from "@/components/property-card";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isReviewWindowOpen } from "@/lib/cancellation";
import { formatCents } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(`/sign-in?redirect=/trips/${id}`);

  const booking = await db.booking.findFirst({
    where: { id, userId: session.id },
    include: {
      property: true,
      lines: { include: { roomType: true } },
      payment: true,
      review: true,
    },
  });

  if (!booking) notFound();

  const canCancel = booking.status === BookingStatus.CONFIRMED;
  const canReview =
    booking.status === BookingStatus.COMPLETED &&
    !booking.review &&
    isReviewWindowOpen(booking.checkOutDate);

  return (
    <>
      <TravelerHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link href="/trips" className="text-sm text-stone-500 hover:text-brand-600">
          ← Back to trips
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{booking.property.name}</h1>
            <p className="text-stone-500">
              {booking.property.city}, {booking.property.state}
            </p>
          </div>
          <Badge
            variant={
              booking.status === BookingStatus.CANCELLED_BY_TRAVELER ||
              booking.status === BookingStatus.CANCELLED_BY_HOTEL
                ? "danger"
                : booking.status === BookingStatus.CONFIRMED
                  ? "success"
                  : "default"
            }
          >
            {booking.status.replace(/_/g, " ")}
          </Badge>
        </div>

        <div className="mt-8 space-y-6">
          <section className="rounded-2xl border border-stone-200 bg-white p-6">
            <h2 className="font-semibold">Reservation</h2>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-stone-500">Confirmation code</dt>
                <dd className="font-mono font-medium">{booking.confirmationCode}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Guests</dt>
                <dd className="font-medium">{booking.guestCount}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Check-in</dt>
                <dd className="font-medium">
                  {format(booking.checkInDate, "EEEE, MMM d, yyyy")} after{" "}
                  {booking.property.checkInTime}
                </dd>
              </div>
              <div>
                <dt className="text-stone-500">Check-out</dt>
                <dd className="font-medium">
                  {format(booking.checkOutDate, "EEEE, MMM d, yyyy")} by{" "}
                  {booking.property.checkOutTime}
                </dd>
              </div>
              {booking.lines.map((line) => (
                <div key={line.id} className="sm:col-span-2">
                  <dt className="text-stone-500">Room</dt>
                  <dd className="font-medium">
                    {line.quantity}× {line.roomType.name} · {line.nights}{" "}
                    {line.nights === 1 ? "night" : "nights"}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-2xl border border-stone-200 bg-white p-6">
            <h2 className="font-semibold">Receipt</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-stone-500">Room total</span>
                <span>{formatCents(booking.roomTotalCents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Taxes & fees</span>
                <span>{formatCents(booking.taxesFeesCents)}</span>
              </div>
              <div className="flex justify-between border-t border-stone-100 pt-2 font-semibold">
                <span>Total</span>
                <span>{formatCents(booking.totalCents)}</span>
              </div>
              {booking.payment && (
                <p className="pt-2 text-stone-500">
                  Payment status: {booking.payment.status.replace(/_/g, " ").toLowerCase()}
                </p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-stone-200 bg-white p-6">
            <h2 className="font-semibold">Property contact</h2>
            <p className="mt-2 text-sm text-stone-600">
              {booking.property.addressLine1}
              <br />
              {booking.property.city}, {booking.property.state} {booking.property.zip}
            </p>
            <p className="mt-2 text-sm text-stone-500">
              Contact the property directly for special requests or arrival questions.
            </p>
          </section>

          <div className="flex flex-wrap gap-3">
            {canCancel && (
              <Link
                href={`/trips/${booking.id}/cancel`}
                className="rounded-xl border border-red-200 px-5 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                Cancel reservation
              </Link>
            )}
            {canReview && (
              <Link
                href={`/trips/${booking.id}/review`}
                className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
              >
                Write a review
              </Link>
            )}
            {booking.review && (
              <p className="text-sm text-stone-500">You submitted a review for this stay.</p>
            )}
            <Link
              href="/help"
              className="rounded-xl border border-stone-200 px-5 py-2.5 text-sm font-medium hover:bg-stone-50"
            >
              Get help
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
