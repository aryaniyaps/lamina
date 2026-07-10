import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { TravelerHeader } from "@/components/traveler-header";
import { Badge } from "@/components/property-card";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { formatCents } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const session = await getSession();

  const booking = await db.booking.findUnique({
    where: { confirmationCode: code },
    include: {
      property: true,
      lines: { include: { roomType: true } },
      payment: true,
    },
  });

  if (!booking) notFound();
  if (session && booking.userId !== session.id) notFound();

  const line = booking.lines[0];

  return (
    <>
      <TravelerHeader />
      <main className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">
            ✓
          </div>
          <h1 className="mt-4 text-2xl font-bold text-stone-900">Booking confirmed!</h1>
          <p className="mt-2 text-stone-600">
            Your reservation at <strong>{booking.property.name}</strong> is confirmed.
          </p>
          <p className="mt-4 font-mono text-lg font-semibold text-brand-600">
            {booking.confirmationCode}
          </p>
        </div>

        <div className="mt-8 space-y-6 rounded-2xl border border-stone-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Reservation details</h2>
            <Badge variant="success">Confirmed</Badge>
          </div>

          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-stone-500">Property</dt>
              <dd className="font-medium">{booking.property.name}</dd>
              <dd className="text-stone-500">
                {booking.property.city}, {booking.property.state}
              </dd>
            </div>
            {line && (
              <div>
                <dt className="text-stone-500">Room</dt>
                <dd className="font-medium">{line.roomType.name}</dd>
              </div>
            )}
            <div>
              <dt className="text-stone-500">Check-in</dt>
              <dd className="font-medium">{format(booking.checkInDate, "EEEE, MMM d, yyyy")}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Check-out</dt>
              <dd className="font-medium">{format(booking.checkOutDate, "EEEE, MMM d, yyyy")}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Guests</dt>
              <dd className="font-medium">{booking.guestCount}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Total paid</dt>
              <dd className="font-medium">{formatCents(booking.totalCents)}</dd>
            </div>
          </dl>

          {booking.guestName && (
            <div className="border-t border-stone-100 pt-4 text-sm">
              <p>
                <span className="text-stone-500">Guest: </span>
                {booking.guestName} ({booking.guestEmail})
              </p>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-stone-500">
          A confirmation email has been sent to {booking.guestEmail ?? "your email"}.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href={`/trips/${booking.id}`}
            className="rounded-xl bg-brand-600 px-6 py-3 text-center font-medium text-white hover:bg-brand-700"
          >
            View reservation
          </Link>
          <Link
            href="/trips"
            className="rounded-xl border border-stone-200 bg-white px-6 py-3 text-center font-medium hover:bg-stone-50"
          >
            My trips
          </Link>
        </div>
      </main>
    </>
  );
}
