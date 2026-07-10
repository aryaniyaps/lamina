import { format } from "date-fns";
import { AdminShell } from "@/components/admin-shell";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guards";

export default async function AdminNotificationsPage() {
  await requireAdmin();

  const notifications = await db.notification.findMany({
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <AdminShell active="/admin/notifications">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Notification log</h1>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Template</th>
              <th className="px-4 py-3 font-medium">Recipient</th>
              <th className="px-4 py-3 font-medium">Subject</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {notifications.map((n) => (
              <tr key={n.id} className="hover:bg-brand-50/50">
                <td className="px-4 py-3 whitespace-nowrap">
                  {format(n.createdAt, "MMM d, yyyy HH:mm")}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{n.templateId}</td>
                <td className="px-4 py-3">
                  <div>{n.recipient}</div>
                  {n.user && <div className="text-xs text-stone-500">{n.user.name}</div>}
                </td>
                <td className="px-4 py-3 max-w-xs truncate">{n.subject}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      n.status === "SENT"
                        ? "bg-brand-50 text-brand-600"
                        : n.status === "FAILED"
                          ? "bg-red-50 text-red-600"
                          : "bg-stone-100 text-stone-600"
                    }`}
                  >
                    {n.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
