import { format } from "date-fns";
import { AdminShell } from "@/components/admin-shell";
import { resolveTicketAction } from "@/lib/actions/admin";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guards";
import { parseJsonArray } from "@/lib/utils";
import { TicketStatus } from "@prisma/client";

export default async function AdminTicketsPage() {
  await requireAdmin();

  const tickets = await db.supportTicket.findMany({
    where: { status: { notIn: [TicketStatus.CLOSED] } },
    include: { user: true, hotelAccount: true },
    orderBy: [{ escalated: "desc" }, { createdAt: "asc" }],
    take: 50,
  });

  return (
    <AdminShell active="/admin/tickets">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Support tickets</h1>

      {tickets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          No open tickets.
        </p>
      ) : (
        <div className="space-y-4">
          {tickets.map((t) => {
            const messages = parseJsonArray<{ from: string; body: string; at: string }>(t.messages);
            return (
              <article
                key={t.id}
                className={`rounded-xl border bg-white p-6 ${
                  t.escalated ? "border-amber-300" : "border-stone-200"
                }`}
              >
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-medium">{t.subject}</h2>
                      {t.escalated && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                          Escalated
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-stone-500">
                      {t.category} · {t.user?.email ?? t.hotelAccount?.legalBusinessName ?? "Guest"} ·{" "}
                      {format(t.createdAt, "MMM d, yyyy")}
                    </div>
                  </div>
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-600">
                    {t.status.replace(/_/g, " ")}
                  </span>
                </div>

                <div className="mb-4 space-y-2">
                  {messages.map((m, i) => (
                    <div key={i} className="rounded-lg bg-stone-50 p-3 text-sm">
                      <div className="mb-1 text-xs text-stone-500">{m.from}</div>
                      {m.body}
                    </div>
                  ))}
                </div>

                {t.status !== TicketStatus.RESOLVED && (
                  <form
                    action={async () => {
                      "use server";
                      await resolveTicketAction(t.id);
                    }}
                  >
                    <button
                      type="submit"
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
                    >
                      Mark resolved
                    </button>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}
