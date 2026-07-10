import Link from "next/link";
import { format } from "date-fns";
import { AdminShell } from "@/components/admin-shell";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guards";
import { formatCents } from "@/lib/utils";
import { BookingStatus, PropertyStatus, TrustReportStatus } from "@prisma/client";

export default async function AdminDashboardPage() {
  await requireAdmin();

  const [
    bookingsCount,
    gmv,
    pendingApprovals,
    trustReports,
    recentBookings,
  ] = await Promise.all([
    db.booking.count({
      where: { status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.COMPLETED] } },
    }),
    db.booking.aggregate({
      where: { status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.COMPLETED] } },
      _sum: { totalCents: true },
    }),
    db.property.count({ where: { status: PropertyStatus.PENDING_REVIEW } }),
    db.trustReport.count({
      where: { status: { in: [TrustReportStatus.SUBMITTED, TrustReportStatus.UNDER_REVIEW] } },
    }),
    db.booking.findMany({
      include: { property: true, user: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return (
    <AdminShell active="/admin">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Dashboard</h1>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Confirmed bookings" value={String(bookingsCount)} href="/admin/bookings" />
        <Kpi label="Gross booking value" value={formatCents(gmv._sum.totalCents ?? 0)} />
        <Kpi label="Pending approvals" value={String(pendingApprovals)} href="/admin/approvals" />
        <Kpi label="Open trust reports" value={String(trustReports)} href="/admin/trust" />
      </div>

      <h2 className="mb-3 text-lg font-medium">Recent bookings</h2>
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Guest</th>
              <th className="px-4 py-3 font-medium">Property</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {recentBookings.map((b) => (
              <tr key={b.id} className="hover:bg-brand-50/50">
                <td className="px-4 py-3">
                  <Link href={`/admin/bookings/${b.id}`} className="font-mono text-brand-600 hover:underline">
                    {b.confirmationCode}
                  </Link>
                </td>
                <td className="px-4 py-3">{b.user.name}</td>
                <td className="px-4 py-3">{b.property.name}</td>
                <td className="px-4 py-3">{formatCents(b.totalCents)}</td>
                <td className="px-4 py-3">{b.status.replace(/_/g, " ")}</td>
                <td className="px-4 py-3">{format(b.createdAt, "MMM d, yyyy")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}

function Kpi({ label, value, href }: { label: string; value: string; href?: string }) {
  const inner = (
    <div className="rounded-lg border border-stone-200 bg-white p-5 hover:border-brand-500">
      <div className="text-sm text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-brand-700">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
