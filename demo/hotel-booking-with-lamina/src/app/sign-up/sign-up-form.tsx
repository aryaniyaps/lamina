"use client";

import { useActionState } from "react";
import { signUpAction } from "@/lib/actions/auth";

export function SignUpForm() {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => signUpAction(formData),
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="role" value="TRAVELER" />

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-stone-700">
          Full name
        </label>
        <input
          id="name"
          name="name"
          required
          autoComplete="name"
          className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3"
        />
      </div>
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
          minLength={8}
          autoComplete="new-password"
          className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3"
        />
        <p className="mt-1 text-xs text-stone-500">At least 8 characters</p>
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
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
