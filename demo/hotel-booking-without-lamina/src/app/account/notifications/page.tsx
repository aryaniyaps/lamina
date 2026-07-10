import Link from "next/link";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { markNotificationsReadAction } from "@/actions/reviews";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const session = await requireAuth();
  const notifications = await db.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Notifications</h1>
        <form action={markNotificationsReadAction}>
          <Button type="submit" variant="ghost" size="sm">Mark all read</Button>
        </form>
      </div>
      <div className="mt-6 space-y-2">
        {notifications.length > 0 ? (
          notifications.map((n) => (
            <div
              key={n.id}
              className={`rounded-lg border border-border p-4 ${!n.isRead ? "bg-teal-50" : "bg-card"}`}
            >
              {n.link ? (
                <Link href={n.link} className="block hover:underline">
                  <p className="font-medium">{n.title}</p>
                  <p className="text-sm text-muted-foreground">{n.body}</p>
                </Link>
              ) : (
                <>
                  <p className="font-medium">{n.title}</p>
                  <p className="text-sm text-muted-foreground">{n.body}</p>
                </>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDistanceToNow(n.createdAt, { addSuffix: true })}
              </p>
            </div>
          ))
        ) : (
          <p className="text-center text-muted-foreground py-8">No notifications yet</p>
        )}
      </div>
    </div>
  );
}
