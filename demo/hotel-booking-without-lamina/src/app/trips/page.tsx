import Link from "next/link";
import Image from "next/image";
import { requireAuth } from "@/lib/session";
import { getGuestBookings } from "@/lib/bookings";
import { formatDateRange } from "@/lib/dates";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Your trips" };

const statusVariant: Record<string, "success" | "warning" | "destructive" | "default"> = {
  CONFIRMED: "success",
  PENDING_PAYMENT: "warning",
  CANCELLED: "destructive",
  COMPLETED: "default",
  NO_SHOW: "destructive",
};

export default async function TripsPage() {
  const session = await requireAuth();
  const bookings = await getGuestBookings(session.user.id);

  const upcoming = bookings.filter(
    (b) => b.status === "CONFIRMED" && new Date(b.checkIn) >= new Date()
  );
  const past = bookings.filter(
    (b) => b.status === "COMPLETED" || b.status === "CANCELLED" || new Date(b.checkOut) < new Date()
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl font-bold">Your trips</h1>

      <section className="mt-8">
        <h2 className="font-display text-xl font-semibold">Upcoming</h2>
        {upcoming.length > 0 ? (
          <div className="mt-4 space-y-4">
            {upcoming.map((booking) => (
              <TripCard key={booking.id} booking={booking} />
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-muted-foreground">No upcoming trips</p>
            <Link href="/search">
              <Button variant="accent" className="mt-4">Find a stay</Button>
            </Link>
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold">Past & cancelled</h2>
          <div className="mt-4 space-y-4">
            {past.map((booking) => (
              <TripCard key={booking.id} booking={booking} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TripCard({
  booking,
}: {
  booking: Awaited<ReturnType<typeof getGuestBookings>>[0];
}) {
  const photo = booking.hotel.photos[0] ?? "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400";

  return (
    <Link
      href={`/trips/${booking.id}`}
      className="flex gap-4 rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-md"
    >
      <div className="relative hidden h-24 w-32 shrink-0 overflow-hidden rounded-lg sm:block">
        <Image src={photo} alt={booking.hotel.name} fill className="object-cover" />
      </div>
      <div className="flex-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">{booking.hotel.name}</h3>
            <p className="text-sm text-muted-foreground">{booking.hotel.city}</p>
          </div>
          <Badge variant={statusVariant[booking.status] ?? "default"}>
            {booking.status.replace("_", " ")}
          </Badge>
        </div>
        <p className="mt-2 text-sm">
          {formatDateRange(booking.checkIn, booking.checkOut)} · {booking.roomType.name}
        </p>
        <p className="mt-1 text-sm font-medium">{formatCurrency(booking.totalAmount)}</p>
      </div>
    </Link>
  );
}
