import { redirect } from "next/navigation";
import Link from "next/link";
import { format, isAfter, startOfDay } from "date-fns";
import { BookingStatus } from "@prisma/client";
import { TravelerHeader } from "@/components/traveler-header";
import { Badge } from "@/components/property-card";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { formatCents } from "@/lib/utils";

export const dynamic = "force-dynamic";

function statusBadge(status: BookingStatus) {
  switch (status) {
    case BookingStatus.CONFIRMED:
      return <Badge variant="success">Confirmed</Badge>;
    case BookingStatus.CHECKED_IN:
      return <Badge variant="success">Checked in</Badge>;
    case BookingStatus.COMPLETED:
      return <Badge>Completed</Badge>;
    case BookingStatus.CANCELLED_BY_TRAVELER:
    case BookingStatus.CANCELLED_BY_HOTEL:
      return <Badge variant="danger">Cancelled</Badge>;
    default:
      return <Badge variant="warning">{status.replace(/_/g, " ")}</Badge>;
  }
}

export default async function TripsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?redirect=/trips");

  const bookings = await db.booking.findMany({
    where: {
      userId: session.id,
      status: {
        in: [
          BookingStatus.CONFIRMED,
          BookingStatus.CHECKED_IN,
          BookingStatus.COMPLETED,
          BookingStatus.CANCELLED_BY_TRAVELER,
          BookingStatus.CANCELLED_BY_HOTEL,
          BookingStatus.NO_SHOW,
        ],
      },
    },
    include: { property: true, lines: { include: { roomType: true } } },
    orderBy: { checkInDate: "desc" },
  });

  const today = startOfDay(new Date());
  const upcoming = bookings.filter(
    (b) =>
      (b.status === BookingStatus.CONFIRMED || b.status === BookingStatus.CHECKED_IN) &&
      !isAfter(today, startOfDay(b.checkOutDate)),
  );
  const past = bookings.filter((b) => !upcoming.includes(b));

  return (
    <>
      <TravelerHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">My trips</h1>
        <p className="mt-1 text-stone-500">Manage your upcoming and past reservations</p>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Upcoming</h2>
          {upcoming.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center">
              <p className="text-stone-500">No upcoming trips.</p>
              <Link href="/search" className="mt-4 inline-block text-sm font-medium text-brand-600">
                Find your next stay →
              </Link>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {upcoming.map((booking) => (
                <TripCard key={booking.id} booking={booking} />
              ))}
            </div>
          )}
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold">Past</h2>
          {past.length === 0 ? (
            <p className="mt-4 text-sm text-stone-500">No past trips yet.</p>
          ) : (
            <div className="mt-4 space-y-4">
              {past.map((booking) => (
                <TripCard key={booking.id} booking={booking} />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function TripCard({
  booking,
}: {
  booking: {
    id: string;
    confirmationCode: string;
    status: BookingStatus;
    checkInDate: Date;
    checkOutDate: Date;
    totalCents: number;
    property: { name: string; city: string; state: string };
    lines: { roomType: { name: string } }[];
  };
}) {
  return (
    <Link
      href={`/trips/${booking.id}`}
      className="block rounded-2xl border border-stone-200 bg-white p-5 transition hover:shadow-md"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold group-hover:text-brand-600">{booking.property.name}</h3>
          <p className="text-sm text-stone-500">
            {booking.property.city}, {booking.property.state}
          </p>
          {booking.lines[0] && (
            <p className="mt-1 text-sm text-stone-600">{booking.lines[0].roomType.name}</p>
          )}
        </div>
        {statusBadge(booking.status)}
      </div>
      <div className="mt-4 flex flex-wrap gap-6 text-sm">
        <div>
          <span className="text-stone-500">Dates </span>
          <span className="font-medium">
            {format(booking.checkInDate, "MMM d")} – {format(booking.checkOutDate, "MMM d, yyyy")}
          </span>
        </div>
        <div>
          <span className="text-stone-500">Confirmation </span>
          <span className="font-mono font-medium">{booking.confirmationCode}</span>
        </div>
        <div>
          <span className="text-stone-500">Total </span>
          <span className="font-medium">{formatCents(booking.totalCents)}</span>
        </div>
      </div>
    </Link>
  );
}
