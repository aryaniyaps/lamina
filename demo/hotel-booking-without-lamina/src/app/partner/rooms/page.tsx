import Link from "next/link";
import { requirePartner } from "@/lib/session";
import { getOwnerHotel, upsertRoomAction } from "@/actions/partner";
import { PartnerLayout } from "../page";
import { formatCurrency } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Rooms" };

export default async function PartnerRoomsPage() {
  const session = await requirePartner();
  const hotel = await getOwnerHotel(session.user.id);

  return (
    <PartnerLayout currentPath="/partner/rooms">
      <h1 className="font-display text-3xl font-bold">Rooms</h1>

      {!hotel ? (
        <p className="mt-4 text-muted-foreground">Create your hotel first.</p>
      ) : (
        <>
          <div className="mt-6 space-y-3">
            {hotel.roomTypes.map((room) => (
              <Link
                key={room.id}
                href={`/partner/rooms/${room.id}`}
                className="flex items-center justify-between rounded-xl border border-border bg-card p-4 hover:shadow-sm"
              >
                <div>
                  <p className="font-semibold">{room.name}</p>
                  <p className="text-sm text-muted-foreground">{room.beds} · {room.capacity} guests · {room.totalRooms} units</p>
                </div>
                <p className="font-medium">{formatCurrency(room.basePrice)}/night</p>
              </Link>
            ))}
          </div>

          <Card className="mt-8">
            <CardHeader title="Add room type" />
            <form action={upsertRoomAction} className="space-y-4">
              <Input id="name" name="name" label="Room name" required />
              <div>
                <label htmlFor="description" className="block text-sm font-medium">Description</label>
                <textarea id="description" name="description" required rows={3} className="mt-1.5 w-full rounded-lg border border-border px-4 py-2.5 text-sm" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input id="capacity" name="capacity" type="number" label="Max guests" defaultValue="2" required />
                <Input id="totalRooms" name="totalRooms" type="number" label="Total rooms" defaultValue="5" required />
              </div>
              <Input id="beds" name="beds" label="Bed configuration" placeholder="1 King bed" required />
              <Input id="basePrice" name="basePrice" type="number" label="Base price (cents)" placeholder="15000" required />
              <Input id="amenities" name="amenities" label="Amenities (comma-separated)" />
              <Input id="photos" name="photos" label="Photo URLs (one per line)" />
              <Button type="submit" variant="accent">Add room</Button>
            </form>
          </Card>
        </>
      )}
    </PartnerLayout>
  );
}
