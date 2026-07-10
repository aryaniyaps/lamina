import Link from "next/link";
import { TravelerHeader } from "@/components/traveler-header";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;

  return (
    <>
      <TravelerHeader />
      <main className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="mt-1 text-stone-500">Sign in to manage your trips and bookings</p>

        <div className="mt-8 rounded-2xl border border-stone-200 bg-white p-6">
          <SignInForm redirect={redirect} />
        </div>

        <p className="mt-6 text-center text-sm text-stone-500">
          Don&apos;t have an account?{" "}
          <Link
            href={redirect ? `/sign-up?redirect=${encodeURIComponent(redirect)}` : "/sign-up"}
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            Sign up
          </Link>
        </p>
      </main>
    </>
  );
}
