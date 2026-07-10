"use client";

import { useActionState } from "react";
import { cancelReservationByHotelAction } from "@/lib/actions/hotel";
import { formatCents } from "@/lib/utils";

export function HotelCancelForm({
  bookingId,
  totalCents,
}: {
  bookingId: string;
  totalCents: number;
}) {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string; success?: boolean } | null, formData: FormData) =>
      cancelReservationByHotelAction(formData),
    null,
  );

  if (state?.success) {
    return (
      <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-6 text-sm text-green-800">
        <p className="font-medium">Reservation cancelled</p>
        <p className="mt-1">
          The guest will receive a full refund of {formatCents(totalCents)}. A confirmation email
          has been sent.
        </p>
      </div>
    );
  }

  return (
    <section className="mt-6 rounded-xl border border-red-200 bg-red-50/50 p-6">
      <h2 className="font-medium text-red-900">Cancel reservation</h2>
      <p className="mt-1 text-sm text-red-800">
        Cancelling will issue a <strong>100% refund ({formatCents(totalCents)})</strong> to the
        guest regardless of the booking policy. This action cannot be undone.
      </p>

      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="bookingId" value={bookingId} />
        <div>
          <label htmlFor="cancel-reason" className="block text-sm font-medium text-stone-700">
            Reason for cancellation <span className="text-red-600">*</span>
          </label>
          <textarea
            id="cancel-reason"
            name="reason"
            required
            minLength={10}
            rows={3}
            placeholder="e.g. Overbooking due to system error; property closure for maintenance"
            className="mt-1 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm"
          />
        </div>

        {state?.error && (
          <p className="text-sm text-red-700" role="alert">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          {pending ? "Cancelling…" : "Cancel reservation & refund guest"}
        </button>
      </form>
    </section>
  );
}
