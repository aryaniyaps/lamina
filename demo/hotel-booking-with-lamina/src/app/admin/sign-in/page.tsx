import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { AdminSignInForm } from "@/components/admin-sign-in-form";
import { getSession } from "@/lib/session";

export default async function AdminSignInPage() {
  const session = await getSession();
  if (
    session?.role === UserRole.PLATFORM_ADMIN ||
    session?.role === UserRole.SUPPORT_AGENT
  ) {
    redirect("/admin");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="text-2xl font-semibold text-brand-600">
            HavenStay Admin
          </Link>
          <p className="mt-2 text-sm text-stone-600">Platform operations console</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
          <AdminSignInForm />
        </div>
      </div>
    </div>
  );
}
