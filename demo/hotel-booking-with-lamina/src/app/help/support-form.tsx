"use client";

import { useActionState } from "react";
import { createSupportTicketAction } from "@/lib/actions/hotel";

export function SupportTicketForm() {
  const [state, action, pending] = useActionState(
    async (_prev: { success?: boolean } | null, formData: FormData) =>
      createSupportTicketAction(formData),
    null,
  );

  if (state?.success) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
        <h3 className="font-semibold text-green-800">Ticket submitted</h3>
        <p className="mt-2 text-sm text-green-700">
          Our support team will respond to your email within 24 hours.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="category" className="block text-sm font-medium text-stone-700">
          Category
        </label>
        <select
          id="category"
          name="category"
          required
          className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3"
        >
          <option value="BOOKING">Booking</option>
          <option value="PAYMENT">Payment</option>
          <option value="ACCOUNT">Account</option>
          <option value="TRUST">Trust & safety</option>
        </select>
      </div>
      <div>
        <label htmlFor="subject" className="block text-sm font-medium text-stone-700">
          Subject
        </label>
        <input
          id="subject"
          name="subject"
          required
          className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3"
        />
      </div>
      <div>
        <label htmlFor="message" className="block text-sm font-medium text-stone-700">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={5}
          className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-brand-600 px-6 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? "Submitting…" : "Submit ticket"}
      </button>
    </form>
  );
}
