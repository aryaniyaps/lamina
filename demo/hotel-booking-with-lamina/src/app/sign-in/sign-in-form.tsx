"use client";

import { useActionState } from "react";
import { signInAction } from "@/lib/actions/auth";
import { DEMO_ACCOUNTS } from "@/lib/constants";

export function SignInForm({ redirect }: { redirect?: string }) {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => signInAction(formData),
    null,
  );

  return (
    <form action={action} className="space-y-4">
      {redirect && <input type="hidden" name="redirect" value={redirect} />}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-stone-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-stone-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3"
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
        className="w-full rounded-xl bg-brand-600 px-4 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-sm text-stone-500">
        Demo: {DEMO_ACCOUNTS.traveler.email} / {DEMO_ACCOUNTS.traveler.password}
      </p>
    </form>
  );
}
