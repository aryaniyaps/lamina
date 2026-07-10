import { format } from "date-fns";
import { AdminShell } from "@/components/admin-shell";
import { suspendUserAction, reinstateUserAction } from "@/lib/actions/admin";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guards";

export default async function AdminUsersPage() {
  await requireAdmin();

  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <AdminShell active="/admin/users">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Users</h1>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-stone-600">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-brand-50/50">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">{u.role.replace(/_/g, " ")}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      u.status === "ACTIVE"
                        ? "bg-brand-50 text-brand-600"
                        : u.status === "SUSPENDED"
                          ? "bg-red-50 text-red-600"
                          : "bg-stone-100 text-stone-600"
                    }`}
                  >
                    {u.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3">{format(u.createdAt, "MMM d, yyyy")}</td>
                <td className="px-4 py-3">
                  {u.status === "ACTIVE" ? (
                    <form
                      action={async (fd) => {
                        "use server";
                        await suspendUserAction(u.id, String(fd.get("reason") || "Terms violation"));
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
                  ) : u.status === "SUSPENDED" ? (
                    <form
                      action={async () => {
                        "use server";
                        await reinstateUserAction(u.id);
                      }}
                    >
                      <button type="submit" className="text-xs text-brand-600 hover:underline">
                        Reinstate
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
