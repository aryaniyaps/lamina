import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { BookingStatus } from "@prisma/client";
import { TravelerHeader } from "@/components/traveler-header";
import { getRefundPreview } from "@/lib/actions/booking";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { CANCELLATION_TEMPLATES } from "@/lib/constants";
import { CancelBookingForm } from "./cancel-form";

export const dynamic = "force-dynamic";

export default async function CancelTripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(`/sign-in?redirect=/trips/${id}/cancel`);

  const booking = await db.booking.findFirst({
    where: { id, userId: session.id },
    include: { property: { include: { cancellationPolicy: true } } },
  });

  if (!booking) notFound();
  if (booking.status !== BookingStatus.CONFIRMED) {
    redirect(`/trips/${id}`);
  }

  const preview = await getRefundPreview(id);
  if (!preview) notFound();

  const policy = booking.property.cancellationPolicy;

  return (
    <>
      <TravelerHeader />
      <main className="mx-auto max-w-xl px-4 py-8">
        <Link href={`/trips/${id}`} className="text-sm text-stone-500 hover:text-brand-600">
          ← Back to reservation
        </Link>

        <h1 className="mt-4 text-2xl font-bold">Cancel reservation</h1>
        <p className="mt-1 text-stone-500">{booking.property.name}</p>
        <p className="mt-1 text-sm text-stone-500">
          {format(booking.checkInDate, "MMM d")} – {format(booking.checkOutDate, "MMM d, yyyy")}
        </p>

        {policy && (
          <div className="mt-6 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm">
            <p className="font-medium text-brand-600">
              {CANCELLATION_TEMPLATES[policy.template].label} policy
            </p>
            <p className="mt-1 text-stone-600">{policy.description}</p>
          </div>
        )}

        <div className="mt-8">
          <CancelBookingForm
            bookingId={id}
            refundCents={preview.refundCents}
            explanation={preview.explanation}
          />
        </div>
      </main>
    </>
  );
}
