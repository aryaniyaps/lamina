import { requirePartner } from "@/lib/session";
import { getOwnerHotel } from "@/actions/partner";
import { getHotelBookings } from "@/lib/bookings";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { Card, CardHeader } from "@/components/ui/card";
import { PartnerNav } from "@/components/layout/partner-nav";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Partner dashboard" };

export default async function PartnerDashboardPage() {
  const session = await requirePartner();
  const hotel = await getOwnerHotel(session.user.id);

  if (!hotel) {
    return (
      <PartnerLayout currentPath="/partner">
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <h1 className="font-display text-2xl font-bold">Welcome to HavenStay Partners</h1>
          <p className="mt-2 text-muted-foreground">Set up your property to start receiving bookings.</p>
          <Link href="/partner/hotel">
            <Button variant="accent" className="mt-6">Create your hotel</Button>
          </Link>
        </div>
      </PartnerLayout>
    );
  }

  const bookings = await getHotelBookings(hotel.id);
  const confirmed = bookings.filter((b) => b.status === "CONFIRMED");
  const revenue = confirmed.reduce((s, b) => s + b.totalAmount, 0);
  const upcoming = confirmed.filter((b) => new Date(b.checkIn) >= new Date()).slice(0, 5);

  const totalRooms = hotel.roomTypes.reduce((s, r) => s + r.totalRooms, 0);
  const occupiedTonight = confirmed.filter((b) => {
    const today = new Date();
    return new Date(b.checkIn) <= today && new Date(b.checkOut) > today;
  }).length;
  const occupancy = totalRooms > 0 ? Math.round((occupiedTonight / totalRooms) * 100) : 0;

  return (
    <PartnerLayout currentPath="/partner">
      <h1 className="font-display text-3xl font-bold">{hotel.name}</h1>
      <p className="text-muted-foreground capitalize">{hotel.status.toLowerCase()}</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted-foreground">Confirmed bookings</p>
          <p className="font-display mt-1 text-3xl font-bold">{confirmed.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Revenue</p>
          <p className="font-display mt-1 text-3xl font-bold">{formatCurrency(revenue)}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted-foreground">Occupancy tonight</p>
          <p className="font-display mt-1 text-3xl font-bold">{occupancy}%</p>
        </Card>
      </div>

      <Card className="mt-8">
        <CardHeader title="Upcoming arrivals" />
        {upcoming.length > 0 ? (
          <div className="space-y-3">
            {upcoming.map((b) => (
              <Link
                key={b.id}
                href={`/partner/reservations/${b.id}`}
                className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted"
              >
                <div>
                  <p className="font-medium">{b.guestName}</p>
                  <p className="text-sm text-muted-foreground">{b.roomType.name}</p>
                </div>
                <p className="text-sm">{formatDate(b.checkIn)}</p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No upcoming arrivals</p>
        )}
      </Card>
    </PartnerLayout>
  );
}

export function PartnerLayout({
  children,
  currentPath,
}: {
  children: React.ReactNode;
  currentPath: string;
}) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <aside>
          <PartnerNav currentPath={currentPath} />
        </aside>
        <div>{children}</div>
      </div>
    </div>
  );
}
