import Link from "next/link";
import { format } from "date-fns";
import { HotelShell } from "@/components/hotel-shell";
import { db } from "@/lib/db";
import { requireHotelStaff, getHotelPropertyIds } from "@/lib/auth-guards";
import { formatCents } from "@/lib/utils";

export default async function HotelReservationsPage() {
  const session = await requireHotelStaff();
  const propertyIds = await getHotelPropertyIds(session.id);

  const bookings = await db.booking.findMany({
    where: { propertyId: { in: propertyIds } },
    include: { property: true, user: true },
    orderBy: { checkInDate: "desc" },
    take: 50,
  });

  return (
    <HotelShell active="/hotel/reservations">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Reservations</h1>

      {bookings.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          No reservations yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-600">
              <tr>
                <th className="px-4 py-3 font-medium">Confirmation</th>
                <th className="px-4 py-3 font-medium">Guest</th>
                <th className="px-4 py-3 font-medium">Property</th>
                <th className="px-4 py-3 font-medium">Dates</th>
                <th className="px-4 py-3 font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {bookings.map((b) => (
                <tr key={b.id} className="hover:bg-brand-50/50">
                  <td className="px-4 py-3">
                    <Link href={`/hotel/reservations/${b.id}`} className="font-mono text-brand-600 hover:underline">
                      {b.confirmationCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{b.guestName ?? b.user.name}</td>
                  <td className="px-4 py-3">{b.property.name}</td>
                  <td className="px-4 py-3">
                    {format(b.checkInDate, "MMM d")} – {format(b.checkOutDate, "MMM d, yyyy")}
                  </td>
                  <td className="px-4 py-3">{formatCents(b.totalCents)}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-600">
                      {b.status.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </HotelShell>
  );
}
