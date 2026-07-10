"use client";

import { useActionState } from "react";
import { signInAction } from "@/lib/actions/auth";
import { DEMO_ACCOUNTS } from "@/lib/constants";

const initial = { error: "" };

export function HotelSignInForm() {
  const [state, action, pending] = useActionState(
    async (_prev: typeof initial, formData: FormData) => {
      const result = await signInAction(formData);
      return result ?? initial;
    },
    initial,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="redirect" value="/hotel" />
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          defaultValue={DEMO_ACCOUNTS.hotel.email}
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          defaultValue={DEMO_ACCOUNTS.hotel.password}
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
