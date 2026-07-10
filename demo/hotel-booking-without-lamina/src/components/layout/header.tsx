import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { isPartnerRole } from "@/lib/auth";
import { getUnreadCount } from "@/lib/notifications";
import { Bell, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export async function Header() {
  const session = await auth();
  const unread = session?.user?.id
    ? await getUnreadCount(session.user.id)
    : 0;

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="font-display text-2xl font-bold text-teal-900">
          HavenStay
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Main">
          <Link href="/search" className="text-sm font-medium text-foreground hover:text-teal-800">
            Explore
          </Link>
          {session && (
            <Link href="/trips" className="text-sm font-medium text-foreground hover:text-teal-800">
              Trips
            </Link>
          )}
          <Link href="/help" className="text-sm font-medium text-foreground hover:text-teal-800">
            Help
          </Link>
          {session && isPartnerRole(session.user.role) && (
            <Link href="/partner" className="text-sm font-medium text-foreground hover:text-teal-800">
              Partner portal
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3">
          {session ? (
            <>
              <Link
                href="/account/notifications"
                className="relative rounded-lg p-2 hover:bg-muted"
                aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
              >
                <Bell className="h-5 w-5" />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
              <Link href="/account" className="hidden text-sm font-medium sm:block">
                {session.user.name ?? session.user.email}
              </Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <Button type="submit" variant="ghost" size="sm">
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <>
              <Link href="/sign-in">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link href="/sign-up">
                <Button variant="accent" size="sm">
                  Get started
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
