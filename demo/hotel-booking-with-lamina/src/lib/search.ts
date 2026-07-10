import { PropertyStatus } from "@prisma/client";
import { db } from "./db";
import { eachNight, startOfDay } from "./utils";
import { getAvailableCount } from "./inventory";

export async function searchProperties(params: {
  city?: string;
  checkIn?: Date;
  checkOut?: Date;
  guests?: number;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
}) {
  const properties = await db.property.findMany({
    where: {
      status: PropertyStatus.LIVE,
      ...(params.city
        ? {
            OR: [
              { city: { contains: params.city } },
              { name: { contains: params.city } },
              { state: { contains: params.city } },
            ],
          }
        : {}),
      ...(params.minRating ? { averageRating: { gte: params.minRating } } : {}),
    },
    include: {
      roomTypes: true,
      cancellationPolicy: true,
    },
    orderBy: [{ averageRating: "desc" }, { reviewCount: "desc" }],
  });

  if (!params.checkIn || !params.checkOut) {
    return properties.map((p) => ({
      property: p,
      fromPriceCents: Math.min(...p.roomTypes.map((r) => r.baseRateCents)),
      available: true,
    }));
  }

  const checkIn = startOfDay(params.checkIn);
  const checkOut = startOfDay(params.checkOut);
  const guests = params.guests ?? 2;
  const nights = eachNight(checkIn, checkOut);

  const results = [];
  for (const property of properties) {
    let bestPrice: number | null = null;
    let anyAvailable = false;

    for (const room of property.roomTypes) {
      if (room.maxOccupancy < guests) continue;

      let roomOk = true;
      let roomTotal = 0;
      for (const night of nights) {
        const avail = await getAvailableCount(
          room.id,
          night,
          room.totalInventoryCount,
        );
        if (avail < 1) {
          roomOk = false;
          break;
        }
        const block = await db.inventoryBlock.findUnique({
          where: { roomTypeId_date: { roomTypeId: room.id, date: startOfDay(night) } },
        });
        roomTotal += block?.rateCents ?? room.baseRateCents;
      }
      if (roomOk) {
        anyAvailable = true;
        const perNight = Math.round(roomTotal / nights.length);
        if (bestPrice === null || perNight < bestPrice) bestPrice = perNight;
      }
    }

    if (!anyAvailable) continue;
    if (params.minPrice && bestPrice && bestPrice < params.minPrice * 100) continue;
    if (params.maxPrice && bestPrice && bestPrice > params.maxPrice * 100) continue;

    results.push({
      property,
      fromPriceCents: bestPrice ?? 0,
      available: true,
    });
  }

  return results;
}

export async function getPropertyBySlug(slug: string) {
  return db.property.findUnique({
    where: { slug },
    include: {
      roomTypes: true,
      cancellationPolicy: true,
      reviews: {
        where: { status: "PUBLISHED" },
        include: { user: true },
        orderBy: { publishedAt: "desc" },
        take: 20,
      },
    },
  });
}
