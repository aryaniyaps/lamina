import { notFound } from "next/navigation";
import { requirePartner } from "@/lib/session";
import { getOwnerHotel, updateBookingStatusAction, sendMessageAction } from "@/actions/partner";
import { PartnerLayout } from "../../page";
import { db } from "@/lib/db";
import { formatDateRange } from "@/lib/dates";
import { formatCurrency } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = { params: Promise<{ id: string }> };

export default async function PartnerReservationDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await requirePartner();
  const hotel = await getOwnerHotel(session.user.id);

  const booking = await db.booking.findFirst({
    where: { id, hotelId: hotel?.id },
    include: {
      roomType: true,
      messageThread: { include: { messages: { include: { sender: true }, orderBy: { createdAt: "asc" } } } },
    },
  });

  if (!booking || !hotel) notFound();

  return (
    <PartnerLayout currentPath="/partner/reservations">
      <h1 className="font-display text-3xl font-bold">{booking.guestName}</h1>
      <p className="text-muted-foreground">{booking.confirmationCode}</p>

      <Card className="mt-8">
        <CardHeader title="Reservation details" />
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt>Email</dt><dd>{booking.guestEmail}</dd></div>
          <div className="flex justify-between"><dt>Room</dt><dd>{booking.roomType.name}</dd></div>
          <div className="flex justify-between"><dt>Dates</dt><dd>{formatDateRange(booking.checkIn, booking.checkOut)}</dd></div>
          <div className="flex justify-between"><dt>Guests</dt><dd>{booking.guests}</dd></div>
          <div className="flex justify-between"><dt>Total</dt><dd>{formatCurrency(booking.totalAmount)}</dd></div>
          <div className="flex justify-between"><dt>Status</dt><dd>{booking.status}</dd></div>
        </dl>
        {booking.status === "CONFIRMED" && (
          <div className="mt-4 flex gap-2">
            <form action={async () => {
              "use server";
              await updateBookingStatusAction(booking.id, "COMPLETED");
            }}>
              <Button type="submit" size="sm">Mark completed</Button>
            </form>
            <form action={async () => {
              "use server";
              await updateBookingStatusAction(booking.id, "NO_SHOW");
            }}>
              <Button type="submit" variant="outline" size="sm">No show</Button>
            </form>
          </div>
        )}
      </Card>

      {booking.messageThread && (
        <Card className="mt-6">
          <CardHeader title="Messages" />
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {booking.messageThread.messages.map((m) => (
              <div key={m.id} className="rounded-lg bg-muted p-2 text-sm">
                <p className="text-xs font-medium">{m.sender.name}</p>
                <p>{m.content}</p>
              </div>
            ))}
          </div>
          <form action={sendMessageAction} className="mt-4 flex gap-2">
            <input type="hidden" name="threadId" value={booking.messageThread.id} />
            <Input name="content" placeholder="Reply to guest..." className="flex-1" required />
            <Button type="submit">Send</Button>
          </form>
        </Card>
      )}
    </PartnerLayout>
  );
}
