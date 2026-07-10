import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { calculateRoomPrice } from "@/lib/availability";
import { calculatePricing } from "@/lib/dates";
import { formatCurrency } from "@/lib/utils";
import { formatDateRange } from "@/lib/dates";
import { parseISO } from "date-fns";
import { createBookingAction } from "@/actions/bookings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/card";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    roomTypeId?: string;
    checkIn?: string;
    checkOut?: string;
    guests?: string;
    cancelled?: string;
  }>;
};

export default async function BookPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const session = await auth();

  if (!session) {
    redirect(`/sign-in?redirect=/hotels/${slug}/book?${new URLSearchParams(sp as Record<string, string>).toString()}`);
  }

  if (!sp.roomTypeId || !sp.checkIn || !sp.checkOut) {
    redirect(`/hotels/${slug}`);
  }

  const hotel = await db.hotel.findUnique({
    where: { slug },
    include: { roomTypes: true },
  });
  const room = hotel?.roomTypes.find((r) => r.id === sp.roomTypeId);
  if (!hotel || !room) notFound();

  const price = await calculateRoomPrice({
    roomTypeId: room.id,
    checkIn: parseISO(sp.checkIn),
    checkOut: parseISO(sp.checkOut),
  });
  if (!price) notFound();

  const pricing = calculatePricing(price.subtotal);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl font-bold">Complete your booking</h1>
      <p className="mt-2 text-muted-foreground">{hotel.name} · {room.name}</p>

      {sp.cancelled && (
        <div className="mt-4 rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-900">
          Payment was cancelled. You can try again below.
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader title="Guest details" description="Who is checking in?" />
          <form action={createBookingAction} className="space-y-4">
            <input type="hidden" name="roomTypeId" value={room.id} />
            <input type="hidden" name="checkIn" value={sp.checkIn} />
            <input type="hidden" name="checkOut" value={sp.checkOut} />
            <input type="hidden" name="guests" value={sp.guests ?? "2"} />
            <Input
              id="guestName"
              name="guestName"
              label="Full name"
              required
              defaultValue={session.user.name ?? ""}
            />
            <Input
              id="guestEmail"
              name="guestEmail"
              type="email"
              label="Email"
              required
              defaultValue={session.user.email ?? ""}
            />
            <Input id="guestPhone" name="guestPhone" label="Phone (optional)" type="tel" />
            <div>
              <label htmlFor="specialRequests" className="block text-sm font-medium">
                Special requests
              </label>
              <textarea
                id="specialRequests"
                name="specialRequests"
                rows={3}
                className="mt-1.5 w-full rounded-lg border border-border px-4 py-2.5 text-sm"
                placeholder="Early check-in, accessibility needs, etc."
              />
            </div>
            <Button type="submit" variant="accent" size="lg" className="w-full">
              Continue to payment
            </Button>
          </form>
        </Card>

        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-semibold">Price summary</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDateRange(sp.checkIn, sp.checkOut)} · {sp.guests ?? 2} guests
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt>Room ({price.nights} nights)</dt>
              <dd>{formatCurrency(pricing.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Taxes</dt>
              <dd>{formatCurrency(pricing.taxAmount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Service fee</dt>
              <dd>{formatCurrency(pricing.serviceFee)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 font-semibold">
              <dt>Total</dt>
              <dd>{formatCurrency(pricing.totalAmount)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">{hotel.cancellationPolicy}</p>
        </div>
      </div>
    </div>
  );
}
