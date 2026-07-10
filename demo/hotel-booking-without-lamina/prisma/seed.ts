import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { addDays, startOfDay } from "date-fns";
import { DEFAULT_CANCELLATION_POLICY } from "../src/lib/dates";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

const HOTEL_IMAGES = [
  "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200",
  "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1200",
  "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=1200",
];

const hotels = [
  {
    name: "Azure Cove Resort",
    city: "Bali",
    country: "Indonesia",
    address: "Jl. Pantai Seminyak 88",
    description: "A serene beachfront escape where turquoise waters meet modern coastal luxury. Wake to ocean breezes and unwind in infinity pools overlooking the Indian Ocean.",
    amenities: ["Pool", "Spa", "Beach access", "Free WiFi", "Restaurant", "Airport shuttle"],
    rating: 4.8,
    reviewCount: 124,
  },
  {
    name: "Harborlight Hotel",
    city: "San Francisco",
    country: "USA",
    address: "450 Embarcadero Way",
    description: "Boutique waterfront hotel in the heart of the city. Floor-to-ceiling bay views, locally sourced dining, and steps from iconic landmarks.",
    amenities: ["Bay views", "Fitness center", "Free WiFi", "Restaurant", "Pet friendly"],
    rating: 4.6,
    reviewCount: 89,
  },
  {
    name: "Mistral Palace",
    city: "Barcelona",
    country: "Spain",
    address: "Carrer de la Marina 210",
    description: "Mediterranean elegance meets contemporary design. Rooftop terrace with Sagrada Familia views and curated Catalan cuisine.",
    amenities: ["Rooftop terrace", "Free WiFi", "Restaurant", "Bar", "Concierge"],
    rating: 4.7,
    reviewCount: 156,
  },
  {
    name: "Sakura Grand",
    city: "Tokyo",
    country: "Japan",
    address: "2-15-1 Shibuya",
    description: "Refined urban sanctuary in Shibuya. Minimalist rooms, onsen-inspired spa, and impeccable service rooted in omotenashi tradition.",
    amenities: ["Spa", "Free WiFi", "Restaurant", "Fitness center", "Concierge"],
    rating: 4.9,
    reviewCount: 203,
  },
  {
    name: "Desert Mirage Lodge",
    city: "Dubai",
    country: "UAE",
    address: "Sheikh Zayed Road 1200",
    description: "Opulent desert oasis with panoramic skyline views. Infinity pool, world-class dining, and bespoke concierge experiences.",
    amenities: ["Pool", "Spa", "Free WiFi", "Restaurant", "Valet parking", "Concierge"],
    rating: 4.5,
    reviewCount: 67,
  },
  {
    name: "Cliffside Haven",
    city: "Santorini",
    country: "Greece",
    address: "Oia Caldera Path 15",
    description: "Iconic whitewashed suites carved into the caldera cliff. Private terraces, sunset views, and Aegean-inspired wellness.",
    amenities: ["Caldera views", "Pool", "Free WiFi", "Breakfast included", "Airport shuttle"],
    rating: 4.9,
    reviewCount: 178,
  },
  {
    name: "Northern Lights Inn",
    city: "Reykjavik",
    country: "Iceland",
    address: "Laugavegur 45",
    description: "Cozy Nordic retreat with geothermal spa and aurora viewing deck. Sustainable design meets Icelandic warmth.",
    amenities: ["Geothermal spa", "Free WiFi", "Restaurant", "Aurora deck", "Eco certified"],
    rating: 4.7,
    reviewCount: 92,
  },
  {
    name: "Palm Court Sydney",
    city: "Sydney",
    country: "Australia",
    address: "88 George Street",
    description: "Harbour-side luxury with Opera House views. Rooftop pool, award-winning dining, and effortless access to the Rocks.",
    amenities: ["Harbour views", "Pool", "Free WiFi", "Restaurant", "Fitness center"],
    rating: 4.6,
    reviewCount: 134,
  },
  {
    name: "Emerald Garden Hotel",
    city: "Singapore",
    country: "Singapore",
    address: "10 Marina Boulevard",
    description: "Urban jungle retreat with lush sky gardens. Panoramic city views, infinity pool, and Michelin-starred dining.",
    amenities: ["Sky garden", "Pool", "Free WiFi", "Restaurant", "Spa", "Fitness center"],
    rating: 4.8,
    reviewCount: 167,
  },
  {
    name: "Alpine Crest Lodge",
    city: "Zermatt",
    country: "Switzerland",
    address: "Bahnhofstrasse 32",
    description: "Matterhorn-facing alpine lodge with ski-in access. Fireside lounge, gourmet fondue, and heated outdoor pool.",
    amenities: ["Ski access", "Spa", "Free WiFi", "Restaurant", "Fireplace lounge"],
    rating: 4.8,
    reviewCount: 78,
  },
];

function slugify(text: string) {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
}

async function main() {
  console.log("Seeding HavenStay...");

  await db.message.deleteMany();
  await db.messageThread.deleteMany();
  await db.notification.deleteMany();
  await db.report.deleteMany();
  await db.supportTicket.deleteMany();
  await db.review.deleteMany();
  await db.payment.deleteMany();
  await db.booking.deleteMany();
  await db.inventoryDay.deleteMany();
  await db.roomType.deleteMany();
  await db.hotel.deleteMany();
  await db.helpArticle.deleteMany();
  await db.session.deleteMany();
  await db.account.deleteMany();
  await db.user.deleteMany();

  const passwordHash = await bcrypt.hash("password123", 12);

  const guest = await db.user.create({
    data: {
      email: "guest@havenstay.com",
      name: "Alex Traveler",
      passwordHash,
      role: "GUEST",
    },
  });

  const owner = await db.user.create({
    data: {
      email: "owner@havenstay.com",
      name: "Maria Santos",
      passwordHash,
      role: "HOTEL_OWNER",
    },
  });

  const admin = await db.user.create({
    data: {
      email: "admin@havenstay.com",
      name: "Platform Admin",
      passwordHash,
      role: "ADMIN",
    },
  });

  const owners = [owner];
  for (let i = 1; i < 5; i++) {
    owners.push(
      await db.user.create({
        data: {
          email: `owner${i}@havenstay.com`,
          name: `Hotel Owner ${i}`,
          passwordHash,
          role: "HOTEL_OWNER",
        },
      })
    );
  }

  const today = startOfDay(new Date());

  for (let i = 0; i < hotels.length; i++) {
    const h = hotels[i];
    const hotelOwner = owners[i % owners.length];

    const hotel = await db.hotel.create({
      data: {
        ownerId: hotelOwner.id,
        name: h.name,
        slug: slugify(h.name),
        description: h.description,
        address: h.address,
        city: h.city,
        country: h.country,
        amenities: h.amenities,
        photos: [HOTEL_IMAGES[i % HOTEL_IMAGES.length], HOTEL_IMAGES[(i + 1) % HOTEL_IMAGES.length]],
        cancellationPolicy: DEFAULT_CANCELLATION_POLICY,
        status: "PUBLISHED",
        rating: h.rating,
        reviewCount: h.reviewCount,
        checkInTime: "15:00",
        checkOutTime: "11:00",
      },
    });

    const roomTypes = [
      {
        name: "Standard Room",
        description: "Comfortable room with essential amenities and city or garden views.",
        capacity: 2,
        beds: "1 Queen bed",
        basePrice: 12000 + i * 1000,
        totalRooms: 8,
        amenities: ["Free WiFi", "Air conditioning", "Mini bar"],
      },
      {
        name: "Deluxe Suite",
        description: "Spacious suite with separate living area and premium furnishings.",
        capacity: 3,
        beds: "1 King bed + sofa bed",
        basePrice: 22000 + i * 1500,
        totalRooms: 4,
        amenities: ["Free WiFi", "Air conditioning", "Mini bar", "Balcony", "Bathtub"],
      },
      {
        name: "Ocean View Suite",
        description: "Premium suite with panoramic views and exclusive amenities.",
        capacity: 4,
        beds: "2 Queen beds",
        basePrice: 35000 + i * 2000,
        totalRooms: 2,
        amenities: ["Free WiFi", "Ocean view", "Mini bar", "Balcony", "Butler service"],
      },
    ];

    for (const rt of roomTypes) {
      const room = await db.roomType.create({
        data: {
          hotelId: hotel.id,
          ...rt,
          photos: [HOTEL_IMAGES[i % HOTEL_IMAGES.length]],
        },
      });

      for (let d = 0; d < 90; d++) {
        const date = addDays(today, d);
        await db.inventoryDay.create({
          data: {
            roomTypeId: room.id,
            date,
            available: rt.totalRooms,
            ...(d % 14 === 0 ? { priceOverride: rt.basePrice + 5000 } : {}),
          },
        });
      }
    }

    if (i < 3) {
      await db.review.create({
        data: {
          hotelId: hotel.id,
          userId: guest.id,
          bookingId: (
            await db.booking.create({
              data: {
                guestId: guest.id,
                hotelId: hotel.id,
                roomTypeId: (await db.roomType.findFirst({ where: { hotelId: hotel.id } }))!.id,
                checkIn: addDays(today, -30),
                checkOut: addDays(today, -27),
                guests: 2,
                status: "COMPLETED",
                guestName: guest.name!,
                guestEmail: guest.email,
                subtotal: 36000,
                taxAmount: 4320,
                serviceFee: 1500,
                totalAmount: 41820,
                cancellationPolicy: DEFAULT_CANCELLATION_POLICY,
                confirmationCode: `HS-DEMO${i}`,
              },
            })
          ).id,
          rating: 5 - (i % 2),
          title: "Wonderful stay",
          content: `Beautiful property in ${h.city}. The staff was attentive and the room exceeded expectations. Would definitely return.`,
        },
      });
    }
  }

  await db.helpArticle.createMany({
    data: [
      { slug: "booking", title: "How to book a stay", category: "Booking", content: "Search, compare, and book.", sortOrder: 1 },
      { slug: "cancellation", title: "Cancellation & refunds", category: "Booking", content: DEFAULT_CANCELLATION_POLICY, sortOrder: 2 },
      { slug: "payments", title: "Payments & pricing", category: "Payments", content: "Transparent pricing with taxes and fees shown upfront.", sortOrder: 3 },
      { slug: "partner", title: "Partner with HavenStay", category: "Partners", content: "List your property on HavenStay.", sortOrder: 4 },
    ],
  });

  console.log("Seed complete!");
  console.log("\nDemo accounts (password: password123):");
  console.log("  Guest:  guest@havenstay.com");
  console.log("  Owner:  owner@havenstay.com");
  console.log("  Admin:  admin@havenstay.com");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
