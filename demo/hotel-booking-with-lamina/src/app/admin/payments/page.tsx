import { format } from "date-fns";
import { AdminShell } from "@/components/admin-shell";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guards";
import { formatCents } from "@/lib/utils";

export default async function AdminPaymentsPage() {
  await requireAdmin();

  const [payments, bookingsWithCommission] = await Promise.all([
    db.payment.findMany({
      include: { booking: { include: { property: true, user: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.booking.findMany({
      where: {
        status: { in: ["CHECKED_IN", "COMPLETED"] },
        commissionCents: { gt: 0 },
      },
      include: { property: { include: { hotelAccount: true } } },
      orderBy: { checkInDate: "desc" },
      take: 30,
    }),
  ]);

  return (
    <AdminShell active="/admin/payments">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Payments & payouts</h1>

      <h2 className="mb-3 text-lg font-medium">Recent payments</h2>
      <div className="mb-10 overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="px-4 py-3 font-medium">Booking</th>
              <th className="px-4 py-3 font-medium">Guest</th>
              <th className="px-4 py-3 font-medium">Property</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {payments.map((p) => (
              <tr key={p.id} className="hover:bg-brand-50/50">
                <td className="px-4 py-3 font-mono text-xs">{p.booking.confirmationCode}</td>
                <td className="px-4 py-3">{p.booking.user.name}</td>
                <td className="px-4 py-3">{p.booking.property.name}</td>
                <td className="px-4 py-3">{formatCents(p.amountCents)}</td>
                <td className="px-4 py-3">{p.status.replace(/_/g, " ")}</td>
                <td className="px-4 py-3">{format(p.createdAt, "MMM d, yyyy")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 text-lg font-medium">Hotel payouts (post check-in)</h2>
      <p className="mb-4 text-sm text-stone-500">
        Payouts are released after guest check-in minus platform commission.
      </p>
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="px-4 py-3 font-medium">Property</th>
              <th className="px-4 py-3 font-medium">Hotel</th>
              <th className="px-4 py-3 font-medium">Booking total</th>
              <th className="px-4 py-3 font-medium">Commission</th>
              <th className="px-4 py-3 font-medium">Hotel payout</th>
              <th className="px-4 py-3 font-medium">Check-in</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {bookingsWithCommission.map((b) => (
              <tr key={b.id} className="hover:bg-brand-50/50">
                <td className="px-4 py-3">{b.property.name}</td>
                <td className="px-4 py-3">{b.property.hotelAccount.legalBusinessName}</td>
                <td className="px-4 py-3">{formatCents(b.totalCents)}</td>
                <td className="px-4 py-3">{formatCents(b.commissionCents)}</td>
                <td className="px-4 py-3 font-medium text-brand-600">
                  {formatCents(b.totalCents - b.commissionCents)}
                </td>
                <td className="px-4 py-3">{format(b.checkInDate, "MMM d, yyyy")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
