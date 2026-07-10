import Link from "next/link";
import { requirePartner } from "@/lib/session";
import { getOwnerHotel } from "@/actions/partner";
import { getHotelBookings } from "@/lib/bookings";
import { PartnerLayout } from "../page";
import { formatDate } from "@/lib/dates";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Reservations" };

export default async function PartnerReservationsPage() {
  const session = await requirePartner();
  const hotel = await getOwnerHotel(session.user.id);
  const bookings = hotel ? await getHotelBookings(hotel.id) : [];

  return (
    <PartnerLayout currentPath="/partner/reservations">
      <h1 className="font-display text-3xl font-bold">Reservations</h1>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="pb-3 pr-4">Guest</th>
              <th className="pb-3 pr-4">Room</th>
              <th className="pb-3 pr-4">Check-in</th>
              <th className="pb-3 pr-4">Total</th>
              <th className="pb-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b.id} className="border-b border-border">
                <td className="py-3 pr-4">
                  <Link href={`/partner/reservations/${b.id}`} className="font-medium hover:underline">
                    {b.guestName}
                  </Link>
                </td>
                <td className="py-3 pr-4">{b.roomType.name}</td>
                <td className="py-3 pr-4">{formatDate(b.checkIn)}</td>
                <td className="py-3 pr-4">{formatCurrency(b.totalAmount)}</td>
                <td className="py-3">
                  <Badge>{b.status.replace("_", " ")}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {bookings.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">No reservations yet</p>
        )}
      </div>
    </PartnerLayout>
  );
}
