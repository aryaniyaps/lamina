import { format } from "date-fns";
import { AdminShell } from "@/components/admin-shell";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guards";

export default async function AdminHotelsPage() {
  await requireAdmin();

  const hotels = await db.hotelAccount.findMany({
    include: {
      staff: { include: { user: true } },
      properties: true,
      _count: { select: { properties: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AdminShell active="/admin/hotels">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Hotel accounts</h1>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="px-4 py-3 font-medium">Business name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Stripe</th>
              <th className="px-4 py-3 font-medium">Properties</th>
              <th className="px-4 py-3 font-medium">Staff</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {hotels.map((h) => (
              <tr key={h.id} className="hover:bg-brand-50/50">
                <td className="px-4 py-3 font-medium">{h.legalBusinessName}</td>
                <td className="px-4 py-3">{h.status}</td>
                <td className="px-4 py-3">
                  {h.stripeConnectComplete ? (
                    <span className="text-brand-600">Connected</span>
                  ) : (
                    <span className="text-stone-400">Pending</span>
                  )}
                </td>
                <td className="px-4 py-3">{h._count.properties}</td>
                <td className="px-4 py-3">
                  {h.staff.map((s) => (
                    <div key={s.id} className="text-xs">
                      {s.user.name} ({s.user.email})
                    </div>
                  ))}
                </td>
                <td className="px-4 py-3">{format(h.createdAt, "MMM d, yyyy")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
