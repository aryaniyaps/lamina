import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { TravelerHeader } from "@/components/traveler-header";
import { registerHotelAccountAction } from "@/lib/actions/hotel";
import { getSession } from "@/lib/session";

export default async function HotelSignUpPage() {
  const session = await getSession();
  if (session?.role === UserRole.HOTEL_STAFF) redirect("/hotel");

  return (
    <div className="min-h-screen bg-stone-50">
      <TravelerHeader />
      <div className="mx-auto max-w-lg px-4 py-16">
        <h1 className="mb-2 text-2xl font-semibold text-brand-700">List your property</h1>
        <p className="mb-8 text-sm text-stone-600">
          Create your hotel account and start the self-serve onboarding wizard.
        </p>
        <form
          action={registerHotelAccountAction}
          className="space-y-4 rounded-xl border border-stone-200 bg-white p-6 shadow-sm"
        >
          <div>
            <label htmlFor="businessName" className="mb-1 block text-sm font-medium">
              Legal business name
            </label>
            <input
              id="businessName"
              name="businessName"
              required
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium">
              Your name
            </label>
            <input
              id="name"
              name="name"
              required
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              Work email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
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
              minLength={8}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Create hotel account
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-stone-500">
          Already have an account?{" "}
          <Link href="/hotel/sign-in" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
