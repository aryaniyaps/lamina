import Link from "next/link";
import { getSession } from "@/lib/session";
import { signOutAction } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

const links = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/approvals", label: "Approvals" },
  { href: "/admin/properties", label: "Properties" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/hotels", label: "Hotels" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/trust", label: "Trust" },
  { href: "/admin/reviews", label: "Reviews" },
  { href: "/admin/tickets", label: "Support" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/notifications", label: "Notifications" },
];

export async function AdminShell({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: string;
}) {
  const session = await getSession();

  return (
    <div className="flex min-h-screen bg-stone-100">
      <aside className="w-64 shrink-0 border-r border-stone-200 bg-white p-4">
        <Link href="/admin" className="mb-6 block text-lg font-semibold text-brand-600">
          HavenStay Admin
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
        <div className="mt-8 border-t border-stone-200 pt-4 text-xs text-stone-500">
          {session?.email}
          <form action={signOutAction} className="mt-2">
            <button type="submit" className="text-brand-600 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
