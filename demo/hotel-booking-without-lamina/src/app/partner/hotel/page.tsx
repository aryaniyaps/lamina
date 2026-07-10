import { requirePartner } from "@/lib/session";
import { getOwnerHotel, upsertHotelAction, publishHotelAction } from "@/actions/partner";
import { PartnerLayout } from "../page";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Property settings" };

export default async function PartnerHotelPage() {
  const session = await requirePartner();
  const hotel = await getOwnerHotel(session.user.id);

  return (
    <PartnerLayout currentPath="/partner/hotel">
      <h1 className="font-display text-3xl font-bold">Property</h1>
      <Card className="mt-8">
        <CardHeader title="Hotel details" description="Manage your property information" />
        <form action={upsertHotelAction} className="space-y-4">
          <Input id="name" name="name" label="Hotel name" defaultValue={hotel?.name ?? ""} required />
          <div>
            <label htmlFor="description" className="block text-sm font-medium">Description</label>
            <textarea id="description" name="description" required rows={4} defaultValue={hotel?.description ?? ""} className="mt-1.5 w-full rounded-lg border border-border px-4 py-2.5 text-sm" />
          </div>
          <Input id="address" name="address" label="Address" defaultValue={hotel?.address ?? ""} required />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input id="city" name="city" label="City" defaultValue={hotel?.city ?? ""} required />
            <Input id="country" name="country" label="Country" defaultValue={hotel?.country ?? ""} required />
          </div>
          <Input id="state" name="state" label="State / Region" defaultValue={hotel?.state ?? ""} />
          <Input id="postalCode" name="postalCode" label="Postal code" defaultValue={hotel?.postalCode ?? ""} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input id="checkInTime" name="checkInTime" label="Check-in time" defaultValue={hotel?.checkInTime ?? "15:00"} />
            <Input id="checkOutTime" name="checkOutTime" label="Check-out time" defaultValue={hotel?.checkOutTime ?? "11:00"} />
          </div>
          <div>
            <label htmlFor="amenities" className="block text-sm font-medium">Amenities (comma-separated)</label>
            <input id="amenities" name="amenities" defaultValue={hotel?.amenities.join(", ") ?? ""} className="mt-1.5 w-full rounded-lg border border-border px-4 py-2.5 text-sm" />
          </div>
          <div>
            <label htmlFor="photos" className="block text-sm font-medium">Photo URLs (one per line)</label>
            <textarea id="photos" name="photos" rows={3} defaultValue={hotel?.photos.join("\n") ?? ""} className="mt-1.5 w-full rounded-lg border border-border px-4 py-2.5 text-sm" />
          </div>
          <div>
            <label htmlFor="cancellationPolicy" className="block text-sm font-medium">Cancellation policy</label>
            <textarea id="cancellationPolicy" name="cancellationPolicy" rows={3} defaultValue={hotel?.cancellationPolicy ?? ""} className="mt-1.5 w-full rounded-lg border border-border px-4 py-2.5 text-sm" />
          </div>
          <Button type="submit">Save property</Button>
        </form>
        {hotel && hotel.status === "DRAFT" && (
          <form action={publishHotelAction} className="mt-4 border-t border-border pt-4">
            <Button type="submit" variant="accent">Publish hotel</Button>
          </form>
        )}
      </Card>
    </PartnerLayout>
  );
}
