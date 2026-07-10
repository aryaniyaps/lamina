import { format } from "date-fns";
import { AdminShell } from "@/components/admin-shell";
import {
  approvePropertyAction,
  rejectPropertyAction,
  requestPropertyChangesAction,
} from "@/lib/actions/admin";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guards";
import { parseJsonArray } from "@/lib/utils";
import { PropertyStatus } from "@prisma/client";

export default async function AdminApprovalsPage() {
  await requireAdmin();

  const pending = await db.property.findMany({
    where: { status: PropertyStatus.PENDING_REVIEW },
    include: { hotelAccount: true, roomTypes: true, cancellationPolicy: true },
    orderBy: { updatedAt: "asc" },
  });

  return (
    <AdminShell active="/admin/approvals">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Property approvals</h1>

      {pending.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          No properties pending review.
        </p>
      ) : (
        <div className="space-y-6">
          {pending.map((p) => {
            const photos = parseJsonArray(p.photos);
            return (
              <article key={p.id} className="rounded-xl border border-stone-200 bg-white p-6">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-medium">{p.name}</h2>
                    <p className="text-sm text-stone-500">
                      {p.hotelAccount.legalBusinessName} · {p.city}, {p.state}
                    </p>
                    <p className="mt-1 text-xs text-stone-400">
                      Submitted {format(p.updatedAt, "MMM d, yyyy")}
                    </p>
                  </div>
                </div>

                <p className="mb-4 text-sm text-stone-700 line-clamp-3">{p.description}</p>

                <dl className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-stone-500">Photos</dt>
                    <dd className="font-medium">{photos.length}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">Room types</dt>
                    <dd className="font-medium">{p.roomTypes.length}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">Policy</dt>
                    <dd className="font-medium">{p.cancellationPolicy?.template ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">Stripe</dt>
                    <dd className="font-medium">
                      {p.hotelAccount.stripeConnectComplete ? "Connected" : "Pending"}
                    </dd>
                  </div>
                </dl>

                <div className="flex flex-wrap gap-3 border-t border-stone-200 pt-4">
                  <form
                    action={async () => {
                      "use server";
                      await approvePropertyAction(p.id);
                    }}
                  >
                    <button
                      type="submit"
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
                    >
                      Approve
                    </button>
                  </form>

                  <form
                    action={async (fd) => {
                      "use server";
                      await rejectPropertyAction(p.id, String(fd.get("reason")));
                    }}
                    className="flex flex-1 gap-2"
                  >
                    <input
                      name="reason"
                      placeholder="Rejection reason"
                      required
                      className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="submit"
                      className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      Reject
                    </button>
                  </form>
                </div>

                <form
                  action={async (fd) => {
                    "use server";
                    await requestPropertyChangesAction(p.id, String(fd.get("notes")));
                  }}
                  className="mt-3 flex gap-2"
                >
                  <input
                    name="notes"
                    placeholder="Request changes (notes to hotel)"
                    className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50"
                  >
                    Request changes
                  </button>
                </form>
              </article>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}
