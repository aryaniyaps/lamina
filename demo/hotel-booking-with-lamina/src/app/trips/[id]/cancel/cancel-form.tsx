"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { cancelBookingAction } from "@/lib/actions/booking";
import { formatCents } from "@/lib/utils";

export function CancelBookingForm({
  bookingId,
  refundCents,
  explanation,
}: {
  bookingId: string;
  refundCents: number;
  explanation: string;
}) {
  const router = useRouter();

  async function cancelAction(
    _prev: { error?: string; success?: boolean; refundCents?: number } | null,
    _formData: FormData,
  ) {
    return cancelBookingAction(bookingId);
  }

  const [state, action, pending] = useActionState(cancelAction, null);

  useEffect(() => {
    if (state?.success) {
      router.push(`/trips/${bookingId}`);
      router.refresh();
    }
  }, [state, bookingId, router]);

  return (
    <form action={action} className="space-y-6">
      <div className="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 className="font-semibold">Refund preview</h2>
        <p className="mt-2 text-2xl font-bold text-brand-600">{formatCents(refundCents)}</p>
        <p className="mt-1 text-sm text-stone-600">{explanation}</p>
      </div>

      {state?.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-red-600 px-6 py-3 font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {pending ? "Cancelling…" : "Confirm cancellation"}
        </button>
      </div>
    </form>
  );
}
