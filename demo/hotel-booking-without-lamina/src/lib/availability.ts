import { db } from "@/lib/db";
import { getStayDates } from "@/lib/dates";

export async function checkAvailability({
  roomTypeId,
  checkIn,
  checkOut,
  guests,
}: {
  roomTypeId: string;
  checkIn: Date;
  checkOut: Date;
  guests: number;
}) {
  const roomType = await db.roomType.findUnique({
    where: { id: roomTypeId },
    include: { hotel: true },
  });

  if (!roomType) {
    return { available: false, reason: "Room type not found" };
  }

  if (guests > roomType.capacity) {
    return { available: false, reason: `Maximum ${roomType.capacity} guests` };
  }

  if (roomType.hotel.status !== "PUBLISHED") {
    return { available: false, reason: "Hotel is not available" };
  }

  const dates = getStayDates(checkIn, checkOut);
  if (dates.length === 0) {
    return { available: false, reason: "Invalid date range" };
  }

  const inventory = await db.inventoryDay.findMany({
    where: {
      roomTypeId,
      date: { in: dates },
    },
  });

  const inventoryMap = new Map(
    inventory.map((day) => [day.date.toISOString().split("T")[0], day])
  );

  for (const date of dates) {
    const key = date.toISOString().split("T")[0];
    const day = inventoryMap.get(key);
    const available = day?.available ?? roomType.totalRooms;

    if (available < 1) {
      return { available: false, reason: "Not available for selected dates" };
    }
  }

  return { available: true, roomType };
}

export async function calculateRoomPrice({
  roomTypeId,
  checkIn,
  checkOut,
}: {
  roomTypeId: string;
  checkIn: Date;
  checkOut: Date;
}) {
  const roomType = await db.roomType.findUnique({
    where: { id: roomTypeId },
  });

  if (!roomType) return null;

  const dates = getStayDates(checkIn, checkOut);
  const inventory = await db.inventoryDay.findMany({
    where: {
      roomTypeId,
      date: { in: dates },
    },
  });

  const inventoryMap = new Map(
    inventory.map((day) => [day.date.toISOString().split("T")[0], day])
  );

  let subtotal = 0;
  const nightlyRates: { date: string; price: number }[] = [];

  for (const date of dates) {
    const key = date.toISOString().split("T")[0];
    const day = inventoryMap.get(key);
    const price = day?.priceOverride ?? roomType.basePrice;
    subtotal += price;
    nightlyRates.push({ date: key, price });
  }

  return { subtotal, nightlyRates, nights: dates.length };
}

export async function decrementInventory({
  roomTypeId,
  checkIn,
  checkOut,
}: {
  roomTypeId: string;
  checkIn: Date;
  checkOut: Date;
}) {
  const roomType = await db.roomType.findUnique({
    where: { id: roomTypeId },
  });
  if (!roomType) throw new Error("Room type not found");

  const dates = getStayDates(checkIn, checkOut);

  await db.$transaction(async (tx) => {
    for (const date of dates) {
      const existing = await tx.inventoryDay.findUnique({
        where: {
          roomTypeId_date: { roomTypeId, date },
        },
      });

      if (existing) {
        if (existing.available < 1) {
          throw new Error("Insufficient inventory");
        }
        await tx.inventoryDay.update({
          where: { id: existing.id },
          data: { available: existing.available - 1 },
        });
      } else {
        if (roomType.totalRooms < 1) {
          throw new Error("Insufficient inventory");
        }
        await tx.inventoryDay.create({
          data: {
            roomTypeId,
            date,
            available: roomType.totalRooms - 1,
          },
        });
      }
    }
  });
}

export async function restoreInventory({
  roomTypeId,
  checkIn,
  checkOut,
}: {
  roomTypeId: string;
  checkIn: Date;
  checkOut: Date;
}) {
  const dates = getStayDates(checkIn, checkOut);

  await db.$transaction(async (tx) => {
    for (const date of dates) {
      const existing = await tx.inventoryDay.findUnique({
        where: {
          roomTypeId_date: { roomTypeId, date },
        },
      });

      if (existing) {
        await tx.inventoryDay.update({
          where: { id: existing.id },
          data: { available: existing.available + 1 },
        });
      }
    }
  });
}
