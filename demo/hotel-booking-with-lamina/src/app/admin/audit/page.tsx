import { format } from "date-fns";
import { AdminShell } from "@/components/admin-shell";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guards";

export default async function AdminAuditPage() {
  await requireAdmin();

  const logs = await db.adminAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <AdminShell active="/admin/audit">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Audit log</h1>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Admin</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {logs.map((l) => (
              <tr key={l.id} className="hover:bg-brand-50/50">
                <td className="px-4 py-3 whitespace-nowrap">
                  {format(l.createdAt, "MMM d, yyyy HH:mm")}
                </td>
                <td className="px-4 py-3">{l.adminEmail}</td>
                <td className="px-4 py-3 font-mono text-xs">{l.action}</td>
                <td className="px-4 py-3">
                  <span className="text-stone-500">{l.targetType}</span>/{l.targetId.slice(0, 8)}…
                </td>
                <td className="px-4 py-3 text-stone-600">{l.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
