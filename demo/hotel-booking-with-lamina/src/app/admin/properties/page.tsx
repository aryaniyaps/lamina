import Link from "next/link";
import { format } from "date-fns";
import { AdminShell } from "@/components/admin-shell";
import { suspendPropertyAction } from "@/lib/actions/admin";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guards";

export default async function AdminPropertiesPage() {
  await requireAdmin();

  const properties = await db.property.findMany({
    include: { hotelAccount: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return (
    <AdminShell active="/admin/properties">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Properties</h1>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Hotel</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Rating</th>
              <th className="px-4 py-3 font-medium">Updated</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {properties.map((p) => (
              <tr key={p.id} className="hover:bg-brand-50/50">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3">{p.hotelAccount.legalBusinessName}</td>
                <td className="px-4 py-3">
                  {p.city}, {p.state}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-600">
                    {p.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {p.averageRating.toFixed(1)} ({p.reviewCount})
                </td>
                <td className="px-4 py-3">{format(p.updatedAt, "MMM d, yyyy")}</td>
                <td className="px-4 py-3">
                  {p.status === "LIVE" && (
                    <form
                      action={async (fd) => {
                        "use server";
                        await suspendPropertyAction(p.id, String(fd.get("reason") || "Policy violation"));
                      }}
                      className="flex gap-1"
                    >
                      <input
                        name="reason"
                        placeholder="Reason"
                        className="w-24 rounded border border-stone-300 px-1 py-0.5 text-xs"
                      />
                      <button type="submit" className="text-xs text-red-600 hover:underline">
                        Suspend
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
