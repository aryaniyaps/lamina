import { requirePartner } from "@/lib/session";
import { getOwnerHotel, respondToReviewAction } from "@/actions/partner";
import { PartnerLayout } from "../page";
import { db } from "@/lib/db";
import { Star } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata = { title: "Reviews" };

export default async function PartnerReviewsPage() {
  const session = await requirePartner();
  const hotel = await getOwnerHotel(session.user.id);

  const reviews = hotel
    ? await db.review.findMany({
        where: { hotelId: hotel.id },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <PartnerLayout currentPath="/partner/reviews">
      <h1 className="font-display text-3xl font-bold">Reviews</h1>
      <div className="mt-6 space-y-4">
        {reviews.map((review) => (
          <Card key={review.id}>
            <div className="flex items-center justify-between">
              <p className="font-medium">{review.user.name ?? "Guest"}</p>
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                {review.rating}
              </div>
            </div>
            {review.title && <p className="mt-2 font-medium">{review.title}</p>}
            <p className="mt-1 text-sm text-muted-foreground">{review.content}</p>
            {review.response ? (
              <p className="mt-3 rounded-lg bg-muted p-3 text-sm">
                <span className="font-medium">Your response:</span> {review.response}
              </p>
            ) : (
              <form action={respondToReviewAction} className="mt-4 flex gap-2">
                <input type="hidden" name="reviewId" value={review.id} />
                <Input name="response" placeholder="Write a response..." className="flex-1" required />
                <Button type="submit" size="sm">Respond</Button>
              </form>
            )}
          </Card>
        ))}
        {reviews.length === 0 && (
          <p className="text-muted-foreground">No reviews yet</p>
        )}
      </div>
    </PartnerLayout>
  );
}
