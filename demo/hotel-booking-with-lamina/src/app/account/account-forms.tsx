"use client";

import { useActionState } from "react";
import { verifyEmailAction, updateProfileAction } from "@/lib/actions/auth";

export function VerifyEmailButton() {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string; success?: boolean } | null) => verifyEmailAction(),
    null,
  );

  return (
    <form action={action}>
      {state?.success && (
        <p className="mb-3 text-sm text-green-700">Email verified successfully!</p>
      )}
      {state?.error && (
        <p className="mb-3 text-sm text-red-700">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? "Verifying…" : "Verify email"}
      </button>
    </form>
  );
}

export function ProfileForm({
  defaultName,
  defaultPhone,
}: {
  defaultName: string;
  defaultPhone: string;
}) {
  const [state, action, pending] = useActionState(
    async (_prev: { error?: string; success?: boolean } | null, formData: FormData) =>
      updateProfileAction(formData),
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-stone-700">
          Full name
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={defaultName}
          className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3"
        />
      </div>
      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-stone-700">
          Phone
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={defaultPhone}
          className="mt-1 w-full rounded-xl border border-stone-200 px-4 py-3"
        />
      </div>

      {state?.success && (
        <p className="text-sm text-green-700">Profile updated.</p>
      )}
      {state?.error && (
        <p className="text-sm text-red-700">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
