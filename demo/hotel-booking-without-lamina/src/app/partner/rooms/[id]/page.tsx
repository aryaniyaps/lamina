import { notFound } from "next/navigation";
import { requirePartner } from "@/lib/session";
import { getOwnerHotel, upsertRoomAction } from "@/actions/partner";
import { PartnerLayout } from "../../page";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Props = { params: Promise<{ id: string }> };

export default async function PartnerRoomDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await requirePartner();
  const hotel = await getOwnerHotel(session.user.id);
  const room = hotel?.roomTypes.find((r) => r.id === id);
  if (!hotel || !room) notFound();

  return (
    <PartnerLayout currentPath="/partner/rooms">
      <h1 className="font-display text-3xl font-bold">{room.name}</h1>
      <Card className="mt-8">
        <CardHeader title="Edit room" />
        <form action={upsertRoomAction} className="space-y-4">
          <input type="hidden" name="id" value={room.id} />
          <Input id="name" name="name" label="Room name" defaultValue={room.name} required />
          <div>
            <label htmlFor="description" className="block text-sm font-medium">Description</label>
            <textarea id="description" name="description" required rows={3} defaultValue={room.description} className="mt-1.5 w-full rounded-lg border border-border px-4 py-2.5 text-sm" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input id="capacity" name="capacity" type="number" label="Max guests" defaultValue={String(room.capacity)} required />
            <Input id="totalRooms" name="totalRooms" type="number" label="Total rooms" defaultValue={String(room.totalRooms)} required />
          </div>
          <Input id="beds" name="beds" label="Beds" defaultValue={room.beds} required />
          <Input id="basePrice" name="basePrice" type="number" label="Base price (cents)" defaultValue={String(room.basePrice)} required />
          <Input id="amenities" name="amenities" label="Amenities" defaultValue={room.amenities.join(", ")} />
          <textarea id="photos" name="photos" rows={3} defaultValue={room.photos.join("\n")} className="w-full rounded-lg border border-border px-4 py-2.5 text-sm" />
          <Button type="submit">Save changes</Button>
        </form>
      </Card>
    </PartnerLayout>
  );
}
