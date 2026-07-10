import Link from "next/link";
import { format } from "date-fns";
import { HotelShell } from "@/components/hotel-shell";
import { db } from "@/lib/db";
import { requireHotelStaff, getHotelContext } from "@/lib/auth-guards";
import { formatCents } from "@/lib/utils";
import { BookingStatus } from "@prisma/client";

export default async function HotelDashboardPage() {
  const session = await requireHotelStaff();
  const ctx = await getHotelContext(session.id);
  const propertyIds = ctx?.hotelAccount.properties.map((p) => p.id) ?? [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekOut = new Date(today);
  weekOut.setDate(weekOut.getDate() + 7);

  const [upcomingArrivals, confirmedCount, monthRevenue, properties] = await Promise.all([
    db.booking.findMany({
      where: {
        propertyId: { in: propertyIds },
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
        checkInDate: { gte: today, lte: weekOut },
      },
      include: { property: true, user: true },
      orderBy: { checkInDate: "asc" },
      take: 10,
    }),
    db.booking.count({
      where: {
        propertyId: { in: propertyIds },
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] },
      },
    }),
    db.booking.aggregate({
      where: {
        propertyId: { in: propertyIds },
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.COMPLETED] },
        createdAt: { gte: new Date(today.getFullYear(), today.getMonth(), 1) },
      },
      _sum: { totalCents: true },
    }),
    ctx?.hotelAccount.properties ?? [],
  ]);

  return (
    <HotelShell active="/hotel">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-brand-700">Dashboard</h1>
        <p className="text-sm text-stone-600">
          {ctx?.hotelAccount.legalBusinessName ?? "Your hotel"}
        </p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <StatCard label="Active reservations" value={String(confirmedCount)} />
        <StatCard
          label="Revenue this month"
          value={formatCents(monthRevenue._sum.totalCents ?? 0)}
        />
        <StatCard label="Properties" value={String(properties.length)} />
      </div>

      {properties.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-lg font-medium">Your properties</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {properties.map((p) => (
              <Link
                key={p.id}
                href={`/hotel/property/${p.id}`}
                className="rounded-lg border border-stone-200 bg-white p-4 hover:border-brand-500"
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-sm text-stone-500">
                  {p.city}, {p.state} · {p.status.replace("_", " ")}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Upcoming arrivals (7 days)</h2>
          <Link href="/hotel/reservations" className="text-sm text-brand-600 hover:underline">
            View all
          </Link>
        </div>
        {upcomingArrivals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
            No arrivals in the next 7 days.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-stone-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Guest</th>
                  <th className="px-4 py-3 font-medium">Property</th>
                  <th className="px-4 py-3 font-medium">Check-in</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {upcomingArrivals.map((b) => (
                  <tr key={b.id} className="hover:bg-brand-50/50">
                    <td className="px-4 py-3">
                      <Link href={`/hotel/reservations/${b.id}`} className="hover:text-brand-600">
                        {b.guestName ?? b.user.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{b.property.name}</td>
                    <td className="px-4 py-3">{format(b.checkInDate, "MMM d, yyyy")}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </HotelShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5">
      <div className="text-sm text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-brand-700">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-600">
      {status.replace(/_/g, " ")}
    </span>
  );
}
