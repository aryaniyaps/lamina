import Link from "next/link";
import { TravelerHeader } from "@/components/traveler-header";
import { SignUpForm } from "./sign-up-form";

export default function SignUpPage() {
  return (
    <>
      <TravelerHeader />
      <main className="mx-auto max-w-md px-4 py-12">
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="mt-1 text-stone-500">Join HavenStay to book boutique stays</p>

        <div className="mt-8 rounded-2xl border border-stone-200 bg-white p-6">
          <SignUpForm />
        </div>

        <p className="mt-6 text-center text-sm text-stone-500">
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </p>
      </main>
    </>
  );
}
