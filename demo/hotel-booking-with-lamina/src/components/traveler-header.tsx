import Link from "next/link";
import { getSession } from "@/lib/session";
import { signOutAction } from "@/lib/actions/auth";

export async function TravelerHeader() {
  const session = await getSession();

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-xl font-semibold text-brand-600">
          HavenStay
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/search" className="hover:text-brand-600">
            Search
          </Link>
          <Link href="/list-your-property" className="hover:text-brand-600">
            List your property
          </Link>
          <Link href="/help" className="hover:text-brand-600">
            Help
          </Link>
          {session ? (
            <>
              <Link href="/trips" className="hover:text-brand-600">
                My Trips
              </Link>
              <Link href="/account" className="hover:text-brand-600">
                Account
              </Link>
              <form action={signOutAction}>
                <button type="submit" className="text-stone-500 hover:text-brand-600">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/sign-in" className="hover:text-brand-600">
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="rounded-full bg-brand-600 px-4 py-2 text-white hover:bg-brand-700"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
