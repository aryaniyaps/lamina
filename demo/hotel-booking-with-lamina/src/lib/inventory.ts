import { db } from "./db";
import { eachNight, dateKey, startOfDay } from "./utils";

export async function ensureInventoryBlocks(
  roomTypeId: string,
  checkIn: Date,
  checkOut: Date,
  baseRateCents: number,
  totalInventory: number,
) {
  const nights = eachNight(checkIn, checkOut);
  for (const night of nights) {
    const day = startOfDay(night);
    await db.inventoryBlock.upsert({
      where: {
        roomTypeId_date: { roomTypeId, date: day },
      },
      create: {
        roomTypeId,
        date: day,
        availableCount: totalInventory,
        rateCents: baseRateCents,
      },
      update: {},
    });
  }
}

export async function getAvailableCount(
  roomTypeId: string,
  date: Date,
  totalInventory: number,
): Promise<number> {
  const day = startOfDay(date);
  const block = await db.inventoryBlock.findUnique({
    where: { roomTypeId_date: { roomTypeId, date: day } },
  });

  const capacity = block?.availableCount ?? totalInventory;

  const confirmed = await db.bookingLine.findMany({
    where: {
      roomTypeId,
      booking: {
        status: { in: ["CONFIRMED", "CHECKED_IN", "COMPLETED"] },
        checkInDate: { lte: day },
        checkOutDate: { gt: day },
      },
    },
  });
  const booked = confirmed.reduce((s, l) => s + l.quantity, 0);

  const holds = await db.inventoryHold.findMany({
    where: {
      roomTypeId,
      status: "ACTIVE",
      expiresAt: { gt: new Date() },
      booking: {
        status: { in: ["DRAFT", "PENDING_PAYMENT"] },
      },
    },
  });
  const held = holds.reduce((s, h) => {
    const nights: string[] = JSON.parse(h.nights);
    return nights.includes(dateKey(day)) ? s + h.quantity : s;
  }, 0);

  return Math.max(0, capacity - booked - held);
}

export async function checkAvailability(
  roomTypeId: string,
  checkIn: Date,
  checkOut: Date,
  quantity: number,
  totalInventory: number,
): Promise<boolean> {
  const nights = eachNight(checkIn, checkOut);
  for (const night of nights) {
    const available = await getAvailableCount(roomTypeId, night, totalInventory);
    if (available < quantity) return false;
  }
  return true;
}

export async function getNightlyRates(
  roomTypeId: string,
  checkIn: Date,
  checkOut: Date,
  baseRateCents: number,
): Promise<{ date: Date; rateCents: number }[]> {
  const nights = eachNight(checkIn, checkOut);
  const rates: { date: Date; rateCents: number }[] = [];

  for (const night of nights) {
    const day = startOfDay(night);
    const block = await db.inventoryBlock.findUnique({
      where: { roomTypeId_date: { roomTypeId, date: day } },
    });
    rates.push({ date: day, rateCents: block?.rateCents ?? baseRateCents });
  }
  return rates;
}
