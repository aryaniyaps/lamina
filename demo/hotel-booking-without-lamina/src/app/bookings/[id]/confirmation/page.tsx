import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { formatDateRange } from "@/lib/dates";
import { formatCurrency } from "@/lib/utils";
import { simulatePaymentAction } from "@/actions/bookings";
import { stripeEnabled } from "@/lib/stripe";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";

type Props = { params: Promise<{ id: string }> };

export const metadata = { title: "Booking confirmed" };

export default async function ConfirmationPage({ params }: Props) {
  const { id } = await params;
  const session = await requireAuth();

  const booking = await db.booking.findUnique({
    where: { id },
    include: { hotel: true, roomType: true },
  });

  if (!booking || booking.guestId !== session.user.id) notFound();

  const isPending = booking.status === "PENDING_PAYMENT";

  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
      {booking.status === "CONFIRMED" ? (
        <>
          <CheckCircle className="mx-auto h-16 w-16 text-teal-600" />
          <h1 className="font-display mt-4 text-3xl font-bold">You&apos;re all set!</h1>
          <p className="mt-2 text-muted-foreground">
            Confirmation {booking.confirmationCode}
          </p>
        </>
      ) : (
        <>
          <h1 className="font-display text-3xl font-bold">Complete payment</h1>
          <p className="mt-2 text-muted-foreground">Your booking is awaiting payment</p>
        </>
      )}

      <div className="mt-8 rounded-xl border border-border bg-card p-6 text-left">
        <h2 className="font-semibold">{booking.hotel.name}</h2>
        <p className="text-sm text-muted-foreground">{booking.roomType.name}</p>
        <p className="mt-2 text-sm">{formatDateRange(booking.checkIn, booking.checkOut)}</p>
        <p className="mt-1 font-medium">{formatCurrency(booking.totalAmount)}</p>
      </div>

      {isPending && !stripeEnabled && (
        <form action={async () => {
          "use server";
          await simulatePaymentAction(booking.id);
        }} className="mt-6">
          <Button type="submit" variant="accent" className="w-full">
            Simulate payment (dev mode)
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Stripe is not configured. Use this to confirm bookings locally.
          </p>
        </form>
      )}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link href={`/trips/${booking.id}`}>
          <Button variant="outline">View trip details</Button>
        </Link>
        <Link href="/trips">
          <Button>All trips</Button>
        </Link>
      </div>
    </div>
  );
}
