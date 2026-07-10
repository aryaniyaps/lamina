"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { createBookingAction } from "@/lib/actions/booking";
import { formatCents } from "@/lib/utils";
import { HoldTimer } from "@/components/hold-timer";

export function CheckoutForm({
  bookingId,
  holdExpiresAt,
  propertySlug,
  propertyId,
  roomTypeId,
  checkIn,
  checkOut,
  guestCount,
  roomName,
  propertyName,
  roomTotalCents,
  taxesFeesCents,
  totalCents,
  policyLabel,
  policyDescription,
  defaultName,
  defaultEmail,
  defaultPhone,
  emailVerified,
}: {
  bookingId: string;
  holdExpiresAt: string;
  propertySlug: string;
  propertyId: string;
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  roomName: string;
  propertyName: string;
  roomTotalCents: number;
  taxesFeesCents: number;
  totalCents: number;
  policyLabel: string;
  policyDescription: string;
  defaultName: string;
  defaultEmail: string;
  defaultPhone: string;
  emailVerified: boolean;
}) {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => createBookingAction(formData),
    null,
  );

  const expiry = new Date(holdExpiresAt).getTime();
  const [holdActive, setHoldActive] = useState(() => expiry > Date.now());

  useEffect(() => {
    const id = setInterval(() => setHoldActive(expiry > Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiry]);

  const canSubmit = holdActive && emailVerified && !pending;

  return (
    <form action={action} className="space-y-6">
      <HoldTimer expiresAt={holdExpiresAt} propertySlug={propertySlug} />

      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="roomTypeId" value={roomTypeId} />
      <input type="hidden" name="checkIn" value={checkIn} />
      <input type="hidden" name="checkOut" value={checkOut} />
      <input type="hidden" name="guestCount" value={guestCount} />
      <input type="hidden" name="quantity" value="1" />

      <fieldset disabled={!holdActive} className="space-y-6 disabled:opacity-60">
        <div className="rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="font-semibold">Guest details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="guestName" className="block text-sm font-medium text-stone-700">
                Full name
              </label>
              <input
                id="guestName"
                name="guestName"
                required
                defaultValue={defaultName}
                className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3"
              />
            </div>
            <div>
              <label htmlFor="guestEmail" className="block text-sm font-medium text-stone-700">
                Email
              </label>
              <input
                id="guestEmail"
                name="guestEmail"
                type="email"
                required
                defaultValue={defaultEmail}
                className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3"
              />
            </div>
            <div>
              <label htmlFor="guestPhone" className="block text-sm font-medium text-stone-700">
                Phone (optional)
              </label>
              <input
                id="guestPhone"
                name="guestPhone"
                type="tel"
                defaultValue={defaultPhone}
                className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="specialRequests" className="block text-sm font-medium text-stone-700">
                Special requests (optional)
              </label>
              <textarea
                id="specialRequests"
                name="specialRequests"
                rows={3}
                maxLength={500}
                className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3"
                placeholder="Early check-in, accessibility needs, etc."
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="font-semibold">Cancellation policy</h2>
          <p className="mt-2 text-sm font-medium text-brand-600">{policyLabel}</p>
          <p className="mt-1 text-sm text-stone-600">{policyDescription}</p>
          <label className="mt-4 flex items-start gap-3">
            <input
              type="checkbox"
              name="policyAccepted"
              required
              className="mt-1 rounded border-stone-300"
            />
            <span className="text-sm text-stone-700">
              I understand and agree to the cancellation policy for this booking.
            </span>
          </label>
        </div>
      </fieldset>

      {state?.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Link href={`/hotels/${propertySlug}`} className="text-sm text-stone-500 hover:text-brand-600">
          ← Back to hotel
        </Link>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-xl bg-brand-600 px-8 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? "Processing…" : `Confirm & pay ${formatCents(totalCents)}`}
        </button>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
        <p>
          <strong>{propertyName}</strong> · {roomName}
        </p>
        <div className="mt-2 space-y-1">
          <div className="flex justify-between">
            <span>Room total</span>
            <span>{formatCents(roomTotalCents)}</span>
          </div>
          <div className="flex justify-between">
            <span>Taxes & fees (est.)</span>
            <span>{formatCents(taxesFeesCents)}</span>
          </div>
          <div className="flex justify-between border-t border-stone-200 pt-2 font-semibold text-stone-900">
            <span>Total</span>
            <span>{formatCents(totalCents)}</span>
          </div>
        </div>
      </div>
    </form>
  );
}
