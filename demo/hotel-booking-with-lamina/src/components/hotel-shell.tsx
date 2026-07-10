import Link from "next/link";
import { getSession } from "@/lib/session";
import { signOutAction } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

const links = [
  { href: "/hotel", label: "Dashboard" },
  { href: "/hotel/onboarding", label: "Onboarding" },
  { href: "/hotel/reservations", label: "Reservations" },
  { href: "/hotel/reviews", label: "Reviews" },
  { href: "/hotel/support", label: "Support" },
];

export async function HotelShell({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: string;
}) {
  const session = await getSession();

  return (
    <div className="flex min-h-screen bg-stone-100">
      <aside className="w-56 shrink-0 border-r border-stone-200 bg-white p-4">
        <Link href="/hotel" className="mb-6 block text-lg font-semibold text-brand-600">
          Hotel Dashboard
        </Link>
        <nav className="space-y-1 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "block rounded-lg px-3 py-2 hover:bg-brand-50",
                active === l.href && "bg-brand-50 font-medium text-brand-600",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <form action={signOutAction} className="mt-8 border-t border-stone-200 pt-4">
          <button type="submit" className="text-sm text-stone-500 hover:text-brand-600">
            Sign out ({session?.email})
          </button>
        </form>
      </aside>
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
