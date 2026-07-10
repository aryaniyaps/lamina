import Link from "next/link";
import { format } from "date-fns";
import { AdminShell } from "@/components/admin-shell";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guards";
import { formatCents } from "@/lib/utils";

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;

  const bookings = await db.booking.findMany({
    where: q
      ? {
          OR: [
            { confirmationCode: { contains: q } },
            { guestName: { contains: q } },
            { guestEmail: { contains: q } },
          ],
        }
      : undefined,
    include: { property: true, user: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <AdminShell active="/admin/bookings">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Bookings</h1>

      <form className="mb-6">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by confirmation code, guest name, or email"
          className="w-full max-w-md rounded-lg border border-stone-300 px-3 py-2 text-sm"
        />
      </form>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Guest</th>
              <th className="px-4 py-3 font-medium">Property</th>
              <th className="px-4 py-3 font-medium">Check-in</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {bookings.map((b) => (
              <tr key={b.id} className="hover:bg-brand-50/50">
                <td className="px-4 py-3">
                  <Link href={`/admin/bookings/${b.id}`} className="font-mono text-brand-600 hover:underline">
                    {b.confirmationCode}
                  </Link>
                </td>
                <td className="px-4 py-3">{b.guestName ?? b.user.name}</td>
                <td className="px-4 py-3">{b.property.name}</td>
                <td className="px-4 py-3">{format(b.checkInDate, "MMM d, yyyy")}</td>
                <td className="px-4 py-3">{formatCents(b.totalCents)}</td>
                <td className="px-4 py-3">{b.status.replace(/_/g, " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
