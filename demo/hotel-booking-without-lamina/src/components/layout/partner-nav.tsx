import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Building2,
  BedDouble,
  Calendar,
  ClipboardList,
  MessageSquare,
  Star,
} from "lucide-react";

const links = [
  { href: "/partner", label: "Overview", icon: LayoutDashboard },
  { href: "/partner/hotel", label: "Property", icon: Building2 },
  { href: "/partner/rooms", label: "Rooms", icon: BedDouble },
  { href: "/partner/calendar", label: "Calendar", icon: Calendar },
  { href: "/partner/reservations", label: "Reservations", icon: ClipboardList },
  { href: "/partner/messages", label: "Messages", icon: MessageSquare },
  { href: "/partner/reviews", label: "Reviews", icon: Star },
];

export function PartnerNav({ currentPath }: { currentPath: string }) {
  return (
    <nav className="space-y-1" aria-label="Partner navigation">
      {links.map(({ href, label, icon: Icon }) => {
        const active = currentPath === href || (href !== "/partner" && currentPath.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-teal-100 text-teal-900"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
