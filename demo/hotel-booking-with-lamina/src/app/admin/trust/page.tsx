import { format } from "date-fns";
import { AdminShell } from "@/components/admin-shell";
import { resolveTrustReportAction } from "@/lib/actions/admin";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guards";
import { TrustReportStatus } from "@prisma/client";

export default async function AdminTrustPage() {
  await requireAdmin();

  const reports = await db.trustReport.findMany({
    where: {
      status: { in: [TrustReportStatus.SUBMITTED, TrustReportStatus.UNDER_REVIEW] },
    },
    include: { reporter: true, property: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <AdminShell active="/admin/trust">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Trust & safety</h1>

      {reports.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          No open trust reports.
        </p>
      ) : (
        <div className="space-y-4">
          {reports.map((r) => (
            <article key={r.id} className="rounded-xl border border-stone-200 bg-white p-6">
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <div className="font-medium">{r.reportType}</div>
                  <div className="text-sm text-stone-500">
                    Reported by {r.reporter.name} · {format(r.createdAt, "MMM d, yyyy")}
                  </div>
                  {r.property && (
                    <div className="text-sm text-stone-500">Property: {r.property.name}</div>
                  )}
                </div>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                  {r.status.replace(/_/g, " ")}
                </span>
              </div>
              <p className="mb-4 text-sm text-stone-700">{r.description}</p>

              <form
                action={async (fd) => {
                  "use server";
                  await resolveTrustReportAction(
                    r.id,
                    String(fd.get("action")),
                    String(fd.get("notes")),
                  );
                }}
                className="flex flex-wrap gap-3 border-t border-stone-200 pt-4"
              >
                <input
                  name="notes"
                  placeholder="Admin notes"
                  className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  name="action"
                  value="dismiss"
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50"
                >
                  Dismiss
                </button>
                <button
                  type="submit"
                  name="action"
                  value="action"
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
                >
                  Take action
                </button>
              </form>
            </article>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
