import { format } from "date-fns";
import { HotelShell } from "@/components/hotel-shell";
import { respondToReviewAction } from "@/lib/actions/hotel";
import { db } from "@/lib/db";
import { requireHotelStaff, getHotelPropertyIds } from "@/lib/auth-guards";

export default async function HotelReviewsPage() {
  const session = await requireHotelStaff();
  const propertyIds = await getHotelPropertyIds(session.id);

  const reviews = await db.review.findMany({
    where: { propertyId: { in: propertyIds }, status: "PUBLISHED" },
    include: { user: true, property: true, booking: true },
    orderBy: { publishedAt: "desc" },
  });

  return (
    <HotelShell active="/hotel/reviews">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Guest reviews</h1>

      {reviews.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
          No reviews yet.
        </p>
      ) : (
        <div className="space-y-4">
          {reviews.map((r) => (
            <article key={r.id} className="rounded-xl border border-stone-200 bg-white p-6">
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <div className="font-medium">{r.user.name}</div>
                  <div className="text-sm text-stone-500">
                    {r.property.name} · {format(r.publishedAt, "MMM d, yyyy")}
                  </div>
                </div>
                <div className="rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-600">
                  {r.overallRating}/5
                </div>
              </div>
              <p className="mb-4 text-sm text-stone-700">{r.bodyText}</p>

              {r.hotelResponse ? (
                <div className="rounded-lg bg-stone-50 p-4 text-sm">
                  <div className="mb-1 font-medium text-brand-600">Your response</div>
                  {r.hotelResponse}
                </div>
              ) : (
                <form
                  action={async (fd) => {
                    "use server";
                    await respondToReviewAction(fd);
                  }}
                  className="space-y-3"
                >
                  <input type="hidden" name="reviewId" value={r.id} />
                  <textarea
                    name="response"
                    rows={3}
                    maxLength={500}
                    required
                    placeholder="Write a professional response…"
                    className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
                  >
                    Post response
                  </button>
                </form>
              )}
            </article>
          ))}
        </div>
      )}
    </HotelShell>
  );
}
