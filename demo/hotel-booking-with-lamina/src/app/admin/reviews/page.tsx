import { format } from "date-fns";
import { AdminShell } from "@/components/admin-shell";
import { removeReviewAction } from "@/lib/actions/admin";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guards";
import { ReviewStatus } from "@prisma/client";

export default async function AdminReviewsPage() {
  await requireAdmin();

  const reviews = await db.review.findMany({
    where: { status: { in: [ReviewStatus.FLAGGED, ReviewStatus.REMOVED, ReviewStatus.PUBLISHED] } },
    include: { user: true, property: true },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });

  const flagged = reviews.filter((r) => r.status === ReviewStatus.FLAGGED);
  const removed = reviews.filter((r) => r.status === ReviewStatus.REMOVED);

  return (
    <AdminShell active="/admin/reviews">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Review moderation</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-medium text-amber-700">Flagged ({flagged.length})</h2>
        {flagged.length === 0 ? (
          <p className="text-sm text-stone-500">No flagged reviews.</p>
        ) : (
          <ReviewList reviews={flagged} showRemove />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Removed ({removed.length})</h2>
        {removed.length === 0 ? (
          <p className="text-sm text-stone-500">No removed reviews.</p>
        ) : (
          <ReviewList reviews={removed} />
        )}
      </section>
    </AdminShell>
  );
}

function ReviewList({
  reviews,
  showRemove,
}: {
  reviews: {
    id: string;
    overallRating: number;
    bodyText: string;
    status: ReviewStatus;
    publishedAt: Date;
    user: { name: string };
    property: { name: string };
  }[];
  showRemove?: boolean;
}) {
  return (
    <div className="space-y-4">
      {reviews.map((r) => (
        <article key={r.id} className="rounded-xl border border-stone-200 bg-white p-6">
          <div className="mb-2 flex items-start justify-between">
            <div>
              <div className="font-medium">{r.user.name}</div>
              <div className="text-sm text-stone-500">
                {r.property.name} · {format(r.publishedAt, "MMM d, yyyy")}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{r.overallRating}/5</span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs">{r.status}</span>
            </div>
          </div>
          <p className="mb-4 text-sm text-stone-700">{r.bodyText}</p>
          {showRemove && (
            <form
              action={async (fd) => {
                "use server";
                await removeReviewAction(r.id, String(fd.get("reason")));
              }}
              className="flex gap-2"
            >
              <input
                name="reason"
                placeholder="Removal reason"
                required
                className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
              >
                Remove
              </button>
            </form>
          )}
        </article>
      ))}
    </div>
  );
}
