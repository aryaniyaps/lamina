import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { BookingStatus } from "@prisma/client";
import { TravelerHeader } from "@/components/traveler-header";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isReviewWindowOpen } from "@/lib/cancellation";
import { ReviewForm } from "./review-form";

export const dynamic = "force-dynamic";

export default async function ReviewTripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(`/sign-in?redirect=/trips/${id}/review`);

  const booking = await db.booking.findFirst({
    where: { id, userId: session.id },
    include: { property: true, review: true },
  });

  if (!booking) notFound();
  if (booking.status !== BookingStatus.COMPLETED) redirect(`/trips/${id}`);
  if (booking.review) redirect(`/trips/${id}`);
  if (!isReviewWindowOpen(booking.checkOutDate)) {
    return (
      <>
        <TravelerHeader />
        <main className="mx-auto max-w-lg px-4 py-16 text-center">
          <h1 className="text-xl font-semibold">Review window closed</h1>
          <p className="mt-2 text-stone-500">
            Reviews must be submitted within 30 days of checkout.
          </p>
          <Link href={`/trips/${id}`} className="mt-6 inline-block text-brand-600">
            Back to reservation →
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <TravelerHeader />
      <main className="mx-auto max-w-xl px-4 py-8">
        <Link href={`/trips/${id}`} className="text-sm text-stone-500 hover:text-brand-600">
          ← Back to reservation
        </Link>

        <h1 className="mt-4 text-2xl font-bold">Write a review</h1>
        <p className="mt-1 text-stone-500">How was your stay at {booking.property.name}?</p>

        <div className="mt-8">
          <ReviewForm bookingId={id} />
        </div>
      </main>
    </>
  );
}
