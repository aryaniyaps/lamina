import { requirePartner } from "@/lib/session";
import { getOwnerHotel, sendMessageAction } from "@/actions/partner";
import { PartnerLayout } from "../page";
import { db } from "@/lib/db";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata = { title: "Messages" };

export default async function PartnerMessagesPage() {
  const session = await requirePartner();
  const hotel = await getOwnerHotel(session.user.id);

  const threads = hotel
    ? await db.messageThread.findMany({
        where: { booking: { hotelId: hotel.id } },
        include: {
          booking: { select: { id: true, guestName: true, confirmationCode: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: { updatedAt: "desc" },
      })
    : [];

  return (
    <PartnerLayout currentPath="/partner/messages">
      <h1 className="font-display text-3xl font-bold">Messages</h1>
      <div className="mt-6 space-y-3">
        {threads.map((thread) => (
          <Card key={thread.id}>
            <div className="flex items-start justify-between">
              <div>
                <Link href={`/partner/reservations/${thread.booking.id}`} className="font-semibold hover:underline">
                  {thread.booking.guestName}
                </Link>
                <p className="text-xs text-muted-foreground">{thread.booking.confirmationCode}</p>
                {thread.messages[0] && (
                  <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                    {thread.messages[0].content}
                  </p>
                )}
              </div>
            </div>
            <form action={sendMessageAction} className="mt-4 flex gap-2">
              <input type="hidden" name="threadId" value={thread.id} />
              <Input name="content" placeholder="Quick reply..." className="flex-1" required />
              <Button type="submit" size="sm">Send</Button>
            </form>
          </Card>
        ))}
        {threads.length === 0 && (
          <p className="text-muted-foreground">No messages yet</p>
        )}
      </div>
    </PartnerLayout>
  );
}
