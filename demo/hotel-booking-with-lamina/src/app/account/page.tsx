import { redirect } from "next/navigation";
import { TravelerHeader } from "@/components/traveler-header";
import { Badge } from "@/components/property-card";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ProfileForm, VerifyEmailButton } from "./account-forms";

export const dynamic = "force-dynamic";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ verify?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in?redirect=/account");

  const user = await db.user.findUnique({ where: { id: session.id } });
  if (!user) redirect("/sign-in");

  const { verify } = await searchParams;
  const isVerified = !!user.emailVerifiedAt;

  return (
    <>
      <TravelerHeader />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold">Account</h1>
        <p className="mt-1 text-stone-500">Manage your profile and preferences</p>

        {verify === "1" && !isVerified && (
          <div className="mt-6 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">
            Welcome! Please verify your email to complete bookings.
          </div>
        )}

        <section className="mt-8 rounded-2xl border border-stone-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Email verification</h2>
            {isVerified ? (
              <Badge variant="success">Verified</Badge>
            ) : (
              <Badge variant="warning">Unverified</Badge>
            )}
          </div>
          <p className="mt-2 text-sm text-stone-600">{user.email}</p>
          {!isVerified && (
            <div className="mt-4">
              <VerifyEmailButton />
            </div>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="font-semibold">Profile</h2>
          <div className="mt-4">
            <ProfileForm defaultName={user.name} defaultPhone={user.phone ?? ""} />
          </div>
        </section>
      </main>
    </>
  );
}
