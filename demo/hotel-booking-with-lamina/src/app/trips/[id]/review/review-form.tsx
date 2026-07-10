"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { submitReviewAction } from "@/lib/actions/booking";

export function ReviewForm({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string; success?: boolean } | null, formData: FormData) =>
      submitReviewAction(formData),
    null,
  );

  useEffect(() => {
    if (state?.success) {
      router.push(`/trips/${bookingId}`);
      router.refresh();
    }
  }, [state, bookingId, router]);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="bookingId" value={bookingId} />

      <div className="rounded-2xl border border-stone-200 bg-white p-6">
        <label htmlFor="overallRating" className="block font-semibold">
          Overall rating
        </label>
        <select
          id="overallRating"
          name="overallRating"
          required
          defaultValue="5"
          className="mt-2 w-full rounded-xl border border-stone-200 px-4 py-3"
        >
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n} — {n === 5 ? "Excellent" : n === 4 ? "Good" : n === 3 ? "Average" : n === 2 ? "Poor" : "Terrible"}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-6">
        <label htmlFor="bodyText" className="block font-semibold">
          Your review
        </label>
        <p className="mt-1 text-sm text-stone-500">Minimum 20 characters</p>
        <textarea
          id="bodyText"
          name="bodyText"
          required
          minLength={20}
          rows={6}
          placeholder="Share your experience — what stood out about your stay?"
          className="mt-3 w-full rounded-xl border border-stone-200 px-4 py-3"
        />
      </div>

      {state?.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-brand-600 px-8 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? "Submitting…" : "Submit review"}
      </button>
    </form>
  );
}
