import { db } from "@/lib/db";
import { calculateRoomPrice } from "@/lib/availability";
import { parseISO } from "date-fns";
import type { Prisma } from "@prisma/client";

export type SearchParams = {
  location?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
  minPrice?: number;
  maxPrice?: number;
  amenities?: string[];
  freeCancel?: boolean;
  minRating?: number;
  sort?: "recommended" | "price_asc" | "price_desc" | "rating";
};

export async function searchHotels(params: SearchParams) {
  const {
    location,
    checkIn,
    checkOut,
    guests = 2,
    minPrice,
    maxPrice,
    amenities = [],
    minRating,
    sort = "recommended",
  } = params;

  const where: Prisma.HotelWhereInput = {
    status: "PUBLISHED",
    ...(location
      ? {
          OR: [
            { city: { contains: location, mode: "insensitive" as const } },
            { name: { contains: location, mode: "insensitive" as const } },
            { country: { contains: location, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(minRating ? { rating: { gte: minRating } } : {}),
    ...(amenities.length > 0
      ? { amenities: { hasEvery: amenities } }
      : {}),
  };

  const hotels = await db.hotel.findMany({
    where,
    include: {
      roomTypes: true,
      reviews: { take: 3, orderBy: { createdAt: "desc" } },
    },
    orderBy:
      sort === "rating"
        ? { rating: "desc" }
        : sort === "price_asc" || sort === "price_desc"
          ? { name: "asc" }
          : { rating: "desc" },
  });

  const results = await Promise.all(
    hotels.map(async (hotel) => {
      const eligibleRooms = hotel.roomTypes.filter((r) => r.capacity >= guests);
      if (eligibleRooms.length === 0) return null;

      let lowestPrice = Math.min(...eligibleRooms.map((r) => r.basePrice));
      let available = true;

      if (checkIn && checkOut) {
        const prices = await Promise.all(
          eligibleRooms.map((room) =>
            calculateRoomPrice({
              roomTypeId: room.id,
              checkIn: parseISO(checkIn),
              checkOut: parseISO(checkOut),
            })
          )
        );

        const validPrices = prices.filter(Boolean);
        if (validPrices.length === 0) {
          available = false;
        } else {
          lowestPrice = Math.min(...validPrices.map((p) => p!.subtotal));
        }
      }

      if (minPrice && lowestPrice < minPrice) return null;
      if (maxPrice && lowestPrice > maxPrice) return null;

      return {
        ...hotel,
        lowestPrice,
        available,
        roomCount: eligibleRooms.length,
      };
    })
  );

  let filtered = results.filter(Boolean) as NonNullable<(typeof results)[0]>[];

  if (sort === "price_asc") {
    filtered.sort((a, b) => a.lowestPrice - b.lowestPrice);
  } else if (sort === "price_desc") {
    filtered.sort((a, b) => b.lowestPrice - a.lowestPrice);
  }

  return filtered;
}

export async function getHotelBySlug(slug: string) {
  return db.hotel.findUnique({
    where: { slug },
    include: {
      roomTypes: { orderBy: { basePrice: "asc" } },
      reviews: {
        include: { user: { select: { name: true, image: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      owner: { select: { name: true, email: true } },
    },
  });
}

export async function getPopularDestinations() {
  const cities = await db.hotel.groupBy({
    by: ["city", "country"],
    where: { status: "PUBLISHED" },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 6,
  });

  return cities.map((c) => ({
    city: c.city,
    country: c.country,
    hotelCount: c._count.id,
  }));
}
