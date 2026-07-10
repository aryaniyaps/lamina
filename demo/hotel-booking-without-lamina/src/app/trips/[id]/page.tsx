import { notFound } from "next/navigation";
import Image from "next/image";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { formatDate, formatDateRange, getCancellationTier, getCancellationMessage } from "@/lib/dates";
import { formatCurrency } from "@/lib/utils";
import { cancelBookingAction } from "@/actions/bookings";
import { createReviewAction, createReportAction } from "@/actions/reviews";
import { sendMessageAction } from "@/actions/partner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/card";

type Props = { params: Promise<{ id: string }> };

export default async function TripDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await requireAuth();

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      hotel: true,
      roomType: true,
      review: true,
      messageThread: { include: { messages: { include: { sender: true }, orderBy: { createdAt: "asc" } } } },
    },
  });

  if (!booking || booking.guestId !== session.user.id) notFound();

  const tier = getCancellationTier(booking.checkIn);
  const canCancel = booking.status === "CONFIRMED";
  const canReview =
    !booking.review &&
    (booking.status === "CONFIRMED" || booking.status === "COMPLETED") &&
    new Date() >= booking.checkOut;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Badge variant={booking.status === "CONFIRMED" ? "success" : "default"}>
            {booking.status.replace("_", " ")}
          </Badge>
          <h1 className="font-display mt-2 text-3xl font-bold">{booking.hotel.name}</h1>
          <p className="text-muted-foreground">{booking.confirmationCode}</p>
        </div>
        <div className="relative h-20 w-28 overflow-hidden rounded-lg">
          <Image
            src={booking.hotel.photos[0] ?? "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400"}
            alt=""
            fill
            className="object-cover"
          />
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="Stay details" />
          <dl className="space-y-2 text-sm">
            <div><dt className="text-muted-foreground">Dates</dt><dd className="font-medium">{formatDateRange(booking.checkIn, booking.checkOut)}</dd></div>
            <div><dt className="text-muted-foreground">Room</dt><dd className="font-medium">{booking.roomType.name}</dd></div>
            <div><dt className="text-muted-foreground">Guests</dt><dd className="font-medium">{booking.guests}</dd></div>
            <div><dt className="text-muted-foreground">Total paid</dt><dd className="font-medium">{formatCurrency(booking.totalAmount)}</dd></div>
            <div><dt className="text-muted-foreground">Address</dt><dd>{booking.hotel.address}, {booking.hotel.city}</dd></div>
          </dl>
        </Card>

        {canCancel && (
          <Card>
            <CardHeader title="Cancellation" description={getCancellationMessage(tier)} />
            <form action={async () => {
              "use server";
              await cancelBookingAction(booking.id);
            }}>
              <Button type="submit" variant="destructive">Cancel booking</Button>
            </form>
          </Card>
        )}
      </div>

      {booking.messageThread && (
        <Card className="mt-6">
          <CardHeader title="Messages with hotel" />
          <div className="max-h-64 space-y-3 overflow-y-auto">
            {booking.messageThread.messages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-lg p-3 text-sm ${
                  msg.senderId === session.user.id ? "ml-8 bg-teal-100" : "mr-8 bg-muted"
                }`}
              >
                <p className="text-xs font-medium text-muted-foreground">{msg.sender.name}</p>
                <p className="mt-1">{msg.content}</p>
              </div>
            ))}
          </div>
          <form action={sendMessageAction} className="mt-4 flex gap-2">
            <input type="hidden" name="threadId" value={booking.messageThread.id} />
            <Input id="content" name="content" placeholder="Write a message..." className="flex-1" required />
            <Button type="submit">Send</Button>
          </form>
        </Card>
      )}

      {canReview && (
        <Card className="mt-6">
          <CardHeader title="Leave a review" />
          <form action={createReviewAction} className="space-y-4">
            <input type="hidden" name="bookingId" value={booking.id} />
            <Input id="rating" name="rating" type="number" label="Rating (1-5)" min={1} max={5} required />
            <Input id="title" name="title" label="Title (optional)" />
            <div>
              <label htmlFor="content" className="block text-sm font-medium">Your review</label>
              <textarea id="content" name="content" required rows={4} className="mt-1.5 w-full rounded-lg border border-border px-4 py-2.5 text-sm" />
            </div>
            <Button type="submit" variant="accent">Submit review</Button>
          </form>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title="Report an issue" />
        <form action={createReportAction} className="space-y-4">
          <input type="hidden" name="hotelId" value={booking.hotelId} />
          <Input id="reason" name="reason" label="Reason" required />
          <div>
            <label htmlFor="description" className="block text-sm font-medium">Details</label>
            <textarea id="description" name="description" rows={3} className="mt-1.5 w-full rounded-lg border border-border px-4 py-2.5 text-sm" />
          </div>
          <Button type="submit" variant="outline">Submit report</Button>
        </form>
      </Card>
    </div>
  );
}
