import { requirePartner } from "@/lib/session";
import { getOwnerHotel, updateInventoryAction } from "@/actions/partner";
import { PartnerLayout } from "../page";
import { db } from "@/lib/db";
import { addDays, format, startOfDay } from "date-fns";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Calendar" };

export default async function PartnerCalendarPage() {
  const session = await requirePartner();
  const hotel = await getOwnerHotel(session.user.id);

  if (!hotel || hotel.roomTypes.length === 0) {
    return (
      <PartnerLayout currentPath="/partner/calendar">
        <p className="text-muted-foreground">Add room types to manage availability.</p>
      </PartnerLayout>
    );
  }

  const roomTypeId = hotel.roomTypes[0].id;
  const today = startOfDay(new Date());
  const dates = Array.from({ length: 14 }, (_, i) => addDays(today, i));

  const inventory = await db.inventoryDay.findMany({
    where: {
      roomTypeId,
      date: { in: dates },
    },
  });

  const invMap = new Map(
    inventory.map((d) => [format(d.date, "yyyy-MM-dd"), d])
  );

  return (
    <PartnerLayout currentPath="/partner/calendar">
      <h1 className="font-display text-3xl font-bold">Calendar</h1>
      <p className="text-muted-foreground">Managing: {hotel.roomTypes[0].name}</p>

      <Card className="mt-8">
        <CardHeader title="Next 14 days" description="Set availability and price overrides" />
        <div className="space-y-3">
          {dates.map((date) => {
            const key = format(date, "yyyy-MM-dd");
            const day = invMap.get(key);
            const defaultAvailable = hotel.roomTypes[0].totalRooms;
            return (
              <form key={key} action={updateInventoryAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
                <input type="hidden" name="roomTypeId" value={roomTypeId} />
                <input type="hidden" name="date" value={key} />
                <div className="min-w-[120px]">
                  <p className="text-sm font-medium">{format(date, "EEE, MMM d")}</p>
                </div>
                <label className="text-sm">
                  Available
                  <input
                    name="available"
                    type="number"
                    min={0}
                    defaultValue={day?.available ?? defaultAvailable}
                    className="ml-2 w-16 rounded border border-border px-2 py-1"
                  />
                </label>
                <label className="text-sm">
                  Price override (¢)
                  <input
                    name="priceOverride"
                    type="number"
                    placeholder="optional"
                    defaultValue={day?.priceOverride ?? ""}
                    className="ml-2 w-24 rounded border border-border px-2 py-1"
                  />
                </label>
                <Button type="submit" size="sm">Save</Button>
              </form>
            );
          })}
        </div>
      </Card>
    </PartnerLayout>
  );
}
