import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { BookingStatus } from "@prisma/client";
import { HotelShell } from "@/components/hotel-shell";
import { markCheckedInAction } from "@/lib/actions/hotel";
import { db } from "@/lib/db";
import { requireHotelStaff, getHotelPropertyIds } from "@/lib/auth-guards";
import { formatCents } from "@/lib/utils";

export default async function ReservationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireHotelStaff();
  const propertyIds = await getHotelPropertyIds(session.id);
  const { id } = await params;

  const booking = await db.booking.findFirst({
    where: { id, propertyId: { in: propertyIds } },
    include: {
      property: true,
      user: true,
      lines: { include: { roomType: true } },
      payment: true,
    },
  });

  if (!booking) notFound();

  const canCheckIn = booking.status === BookingStatus.CONFIRMED;

  return (
    <HotelShell active="/hotel/reservations">
      <Link href="/hotel/reservations" className="text-sm text-brand-600 hover:underline">
        ← All reservations
      </Link>

      <div className="mt-4 mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-700">{booking.confirmationCode}</h1>
          <p className="text-sm text-stone-500">{booking.property.name}</p>
        </div>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-600">
          {booking.status.replace(/_/g, " ")}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="mb-4 font-medium">Guest</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Name" value={booking.guestName ?? booking.user.name} />
            <Row label="Email" value={booking.guestEmail ?? booking.user.email} />
            <Row label="Phone" value={booking.guestPhone ?? booking.user.phone ?? "—"} />
            <Row label="Guests" value={String(booking.guestCount)} />
          </dl>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="mb-4 font-medium">Stay</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Check-in" value={format(booking.checkInDate, "EEEE, MMM d, yyyy")} />
            <Row label="Check-out" value={format(booking.checkOutDate, "EEEE, MMM d, yyyy")} />
            <Row label="Total" value={formatCents(booking.totalCents)} />
            {booking.specialRequests && (
              <Row label="Special requests" value={booking.specialRequests} />
            )}
          </dl>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-stone-200 bg-white p-6">
        <h2 className="mb-4 font-medium">Rooms</h2>
        <ul className="space-y-2 text-sm">
          {booking.lines.map((l) => (
            <li key={l.id} className="flex justify-between">
              <span>
                {l.quantity}× {l.roomType.name} ({l.nights} nights)
              </span>
              <span>{formatCents(l.ratePerNightCents * l.nights * l.quantity)}</span>
            </li>
          ))}
        </ul>
      </section>

      {canCheckIn && (
        <form
          action={async () => {
            "use server";
            await markCheckedInAction(booking.id);
          }}
          className="mt-6"
        >
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Mark checked in
          </button>
        </form>
      )}
    </HotelShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
