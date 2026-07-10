import { redirect } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { PropertyStatus } from "@prisma/client";
import { TravelerHeader } from "@/components/traveler-header";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getNightlyRates } from "@/lib/inventory";
import { CANCELLATION_TEMPLATES, TAX_RATE_ESTIMATE } from "@/lib/constants";
import { formatCents, startOfDay } from "@/lib/utils";
import { CheckoutForm } from "./checkout-form";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{
    propertyId?: string;
    roomTypeId?: string;
    checkIn?: string;
    checkOut?: string;
    guestCount?: string;
  }>;
}) {
  const params = await searchParams;
  const { propertyId, roomTypeId, checkIn, checkOut, guestCount } = params;

  if (!propertyId || !roomTypeId || !checkIn || !checkOut) {
    return (
      <>
        <TravelerHeader />
        <main className="mx-auto max-w-lg px-4 py-16 text-center">
          <h1 className="text-xl font-semibold">Missing booking details</h1>
          <p className="mt-2 text-stone-500">Please select a room from a property page to continue.</p>
          <Link
            href="/search"
            className="mt-6 inline-block text-brand-600 hover:text-brand-700"
          >
            Browse properties →
          </Link>
        </main>
      </>
    );
  }

  const session = await getSession();
  if (!session) {
    const redirectUrl = `/checkout?${new URLSearchParams(params as Record<string, string>)}`;
    redirect(`/sign-in?redirect=${encodeURIComponent(redirectUrl)}`);
  }

  const user = await db.user.findUnique({ where: { id: session.id } });
  const property = await db.property.findUnique({
    where: { id: propertyId },
    include: { cancellationPolicy: true, roomTypes: true },
  });
  const room = property?.roomTypes.find((r) => r.id === roomTypeId);

  if (!property || property.status !== PropertyStatus.LIVE || !room) {
    return (
      <>
        <TravelerHeader />
        <main className="mx-auto max-w-lg px-4 py-16 text-center">
          <h1 className="text-xl font-semibold">Property unavailable</h1>
          <p className="mt-2 text-stone-500">This room is no longer available.</p>
          <Link href="/search" className="mt-6 inline-block text-brand-600 hover:text-brand-700">
            Find another stay →
          </Link>
        </main>
      </>
    );
  }

  const checkInDate = startOfDay(new Date(checkIn));
  const checkOutDate = startOfDay(new Date(checkOut));
  const guests = Number(guestCount ?? "2");

  const rates = await getNightlyRates(room.id, checkInDate, checkOutDate, room.baseRateCents);
  const roomTotalCents = rates.reduce((s, r) => s + r.rateCents, 0);
  const taxesFeesCents = Math.round(roomTotalCents * TAX_RATE_ESTIMATE);
  const totalCents = roomTotalCents + taxesFeesCents;

  const policy = property.cancellationPolicy;
  const policyLabel = policy
    ? CANCELLATION_TEMPLATES[policy.template].label
    : "Flexible";
  const policyDescription = policy?.description ?? "Full refund until 24 hours before check-in.";

  return (
    <>
      <TravelerHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold">Complete your booking</h1>
        <p className="mt-1 text-stone-500">
          {property.name} · {format(checkInDate, "MMM d")} – {format(checkOutDate, "MMM d")} ·{" "}
          {guests} {guests === 1 ? "guest" : "guests"}
        </p>

        {!user?.emailVerifiedAt && (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Please{" "}
            <Link href="/account" className="font-medium underline">
              verify your email
            </Link>{" "}
            before completing your booking.
          </div>
        )}

        <div className="mt-8">
          <CheckoutForm
            propertyId={propertyId}
            roomTypeId={roomTypeId}
            checkIn={checkIn}
            checkOut={checkOut}
            guestCount={guests}
            roomName={room.name}
            propertyName={property.name}
            roomTotalCents={roomTotalCents}
            taxesFeesCents={taxesFeesCents}
            totalCents={totalCents}
            policyLabel={policyLabel}
            policyDescription={policyDescription}
            defaultName={user?.name ?? session.name}
            defaultEmail={user?.email ?? session.email}
            defaultPhone={user?.phone ?? ""}
          />
        </div>
      </main>
    </>
  );
}
