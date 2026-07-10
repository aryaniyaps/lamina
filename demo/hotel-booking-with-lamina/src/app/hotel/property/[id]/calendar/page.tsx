import Link from "next/link";
import { notFound } from "next/navigation";
import { addDays, format } from "date-fns";
import { HotelShell } from "@/components/hotel-shell";
import { updateInventoryAction } from "@/lib/actions/hotel";
import { requireHotelStaff, getHotelContext } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { dateKey } from "@/lib/utils";

export default async function InventoryCalendarPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireHotelStaff();
  const ctx = await getHotelContext(session.id);
  const { id } = await params;

  const property = ctx?.hotelAccount.properties.find((p) => p.id === id);
  if (!property) notFound();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));

  const roomTypeIds = property.roomTypes.map((r) => r.id);
  const blocks = await db.inventoryBlock.findMany({
    where: {
      roomTypeId: { in: roomTypeIds },
      date: { gte: today, lte: addDays(today, 13) },
    },
  });

  const blockMap = new Map(
    blocks.map((b) => [`${b.roomTypeId}:${dateKey(b.date)}`, b]),
  );

  return (
    <HotelShell active="/hotel">
      <div className="mb-6">
        <Link href={`/hotel/property/${id}`} className="text-sm text-brand-600 hover:underline">
          ← Back to property
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-700">Inventory calendar</h1>
        <p className="text-sm text-stone-500">{property.name} — next 14 days</p>
      </div>

      {property.roomTypes.length === 0 ? (
        <p className="text-sm text-stone-500">Add room types in onboarding first.</p>
      ) : (
        <div className="space-y-8">
          {property.roomTypes.map((room) => (
            <div key={room.id} className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
              <div className="border-b border-stone-200 bg-stone-50 px-4 py-3 font-medium">
                {room.name} (base ${(room.baseRateCents / 100).toFixed(0)}/night)
              </div>
              <table className="w-full min-w-[800px] text-xs">
                <thead>
                  <tr className="text-left text-stone-500">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Available</th>
                    <th className="px-3 py-2">Rate ($)</th>
                    <th className="px-3 py-2">Update</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {days.map((day) => {
                    const key = `${room.id}:${dateKey(day)}`;
                    const block = blockMap.get(key);
                    const available = block?.availableCount ?? room.totalInventoryCount;
                    const rate = (block?.rateCents ?? room.baseRateCents) / 100;

                    return (
                      <tr key={key}>
                        <td className="px-3 py-2">{format(day, "EEE MMM d")}</td>
                        <td className="px-3 py-2">{available}</td>
                        <td className="px-3 py-2">${rate.toFixed(0)}</td>
                        <td className="px-3 py-2">
                          <form
                            action={async (fd) => {
                              "use server";
                              await updateInventoryAction(fd);
                            }}
                            className="flex items-center gap-2"
                          >
                            <input type="hidden" name="roomTypeId" value={room.id} />
                            <input type="hidden" name="date" value={dateKey(day)} />
                            <input
                              name="availableCount"
                              type="number"
                              min={0}
                              max={room.totalInventoryCount}
                              defaultValue={available}
                              className="w-14 rounded border border-stone-300 px-1 py-0.5"
                            />
                            <input
                              name="rate"
                              type="number"
                              step="0.01"
                              defaultValue={rate}
                              className="w-16 rounded border border-stone-300 px-1 py-0.5"
                            />
                            <button
                              type="submit"
                              className="rounded bg-brand-600 px-2 py-0.5 text-white hover:bg-brand-700"
                            >
                              Save
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </HotelShell>
  );
}
