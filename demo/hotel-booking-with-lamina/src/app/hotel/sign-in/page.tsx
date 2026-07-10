import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { TravelerHeader } from "@/components/traveler-header";
import { HotelSignInForm } from "@/components/hotel-sign-in-form";
import { getSession } from "@/lib/session";

export default async function HotelSignInPage() {
  const session = await getSession();
  if (session?.role === UserRole.HOTEL_STAFF) redirect("/hotel");

  return (
    <div className="min-h-screen bg-stone-50">
      <TravelerHeader />
      <div className="mx-auto max-w-md px-4 py-16">
        <h1 className="mb-2 text-2xl font-semibold text-brand-700">Hotel staff sign in</h1>
        <p className="mb-8 text-sm text-stone-600">
          Access your property dashboard to manage reservations and listings.
        </p>
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <HotelSignInForm />
        </div>
        <p className="mt-6 text-center text-sm text-stone-500">
          New to HavenStay?{" "}
          <Link href="/hotel/sign-up" className="font-medium text-brand-600 hover:underline">
            Register your hotel
          </Link>
        </p>
      </div>
    </div>
  );
}
