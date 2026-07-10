import {
  PrismaClient,
  UserRole,
  UserStatus,
  PropertyStatus,
  HotelAccountStatus,
  CancellationTemplate,
  BookingStatus,
  PaymentStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDays, subDays } from "date-fns";

const db = new PrismaClient();

const UNSPLASH = [
  "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800",
  "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800",
  "https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=800",
  "https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800",
  "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=800",
  "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800",
];

async function main() {
  await db.adminAuditLog.deleteMany();
  await db.notification.deleteMany();
  await db.trustReport.deleteMany();
  await db.supportTicket.deleteMany();
  await db.review.deleteMany();
  await db.refund.deleteMany();
  await db.payment.deleteMany();
  await db.inventoryHold.deleteMany();
  await db.bookingLine.deleteMany();
  await db.booking.deleteMany();
  await db.inventoryBlock.deleteMany();
  await db.roomType.deleteMany();
  await db.cancellationPolicy.deleteMany();
  await db.property.deleteMany();
  await db.hotelStaff.deleteMany();
  await db.hotelAccount.deleteMany();
  await db.user.deleteMany();
  await db.platformConfig.deleteMany();

  const hash = await bcrypt.hash("demo1234", 12);

  const traveler = await db.user.create({
    data: {
      email: "traveler@havenstay.demo",
      passwordHash: hash,
      name: "Alex Traveler",
      role: UserRole.TRAVELER,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  const hotelUser = await db.user.create({
    data: {
      email: "hotel@havenstay.demo",
      passwordHash: hash,
      name: "Jordan Operator",
      role: UserRole.HOTEL_STAFF,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  await db.user.create({
    data: {
      email: "admin@havenstay.demo",
      passwordHash: hash,
      name: "Sam Admin",
      role: UserRole.PLATFORM_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  await db.platformConfig.create({ data: { id: "default", commissionRate: 0.15 } });

  const account = await db.hotelAccount.create({
    data: {
      legalBusinessName: "Harbor Boutique Hotels LLC",
      status: HotelAccountStatus.ACTIVE,
      stripeConnectComplete: true,
      stripeConnectId: "acct_demo_harbor",
    },
  });

  await db.hotelStaff.create({
    data: { userId: hotelUser.id, hotelAccountId: account.id, staffRole: "owner" },
  });

  const properties = [
    {
      slug: "the-harbor-house",
      name: "The Harbor House",
      city: "Portland",
      state: "OR",
      description:
        "A charming boutique hotel in the heart of Portland's Pearl District. Locally sourced breakfast, rooftop terrace, and thoughtfully designed rooms.",
      lat: 45.5231,
      lng: -122.6765,
      status: PropertyStatus.LIVE,
    },
    {
      slug: "willow-inn-austin",
      name: "Willow Inn Austin",
      city: "Austin",
      state: "TX",
      description:
        "Independent hotel steps from South Congress. Pool, live music lounge, and spacious suites for business and leisure travelers.",
      lat: 30.2505,
      lng: -97.7497,
      status: PropertyStatus.LIVE,
    },
    {
      slug: "coastal-retreat-santa-barbara",
      name: "Coastal Retreat Santa Barbara",
      city: "Santa Barbara",
      state: "CA",
      description:
        "Ocean-view boutique property with spa services, farm-to-table dining, and serene coastal ambiance.",
      lat: 34.4208,
      lng: -119.6982,
      status: PropertyStatus.LIVE,
    },
    {
      slug: "maple-boutique-denver",
      name: "Maple Boutique Denver",
      city: "Denver",
      state: "CO",
      description: "Modern independent hotel near LoDo with mountain views, co-working lounge, and pet-friendly rooms.",
      lat: 39.7392,
      lng: -104.9903,
      status: PropertyStatus.PENDING_REVIEW,
    },
  ];

  for (const p of properties) {
    const property = await db.property.create({
      data: {
        hotelAccountId: account.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        addressLine1: "123 Main Street",
        city: p.city,
        state: p.state,
        zip: "00000",
        latitude: p.lat,
        longitude: p.lng,
        photos: JSON.stringify(UNSPLASH),
        amenities: JSON.stringify([
          "Free WiFi",
          "Parking",
          "Breakfast included",
          "Fitness center",
        ]),
        status: p.status,
        averageRating: p.status === PropertyStatus.LIVE ? 4.6 : 0,
        reviewCount: p.status === PropertyStatus.LIVE ? 12 : 0,
      },
    });

    await db.cancellationPolicy.create({
      data: {
        propertyId: property.id,
        template: CancellationTemplate.MODERATE,
        description:
          "Full refund until 5 days before check-in. 50% refund until 24 hours before.",
      },
    });

    const roomTypes = [
      {
        name: "Standard King",
        description: "King bed, city view, workspace desk",
        maxOccupancy: 2,
        bedConfiguration: "1 King",
        baseRateCents: 18900,
        inventory: 8,
      },
      {
        name: "Deluxe Suite",
        description: "Separate living area, king bed, premium amenities",
        maxOccupancy: 3,
        bedConfiguration: "1 King + Sofa",
        baseRateCents: 28900,
        inventory: 4,
      },
    ];

    for (const rt of roomTypes) {
      const room = await db.roomType.create({
        data: {
          propertyId: property.id,
          name: rt.name,
          description: rt.description,
          maxOccupancy: rt.maxOccupancy,
          bedConfiguration: rt.bedConfiguration,
          baseRateCents: rt.baseRateCents,
          totalInventoryCount: rt.inventory,
          photos: JSON.stringify([UNSPLASH[0]]),
        },
      });

      for (let i = 0; i < 60; i++) {
        const date = addDays(new Date(), i);
        date.setHours(0, 0, 0, 0);
        await db.inventoryBlock.create({
          data: {
            roomTypeId: room.id,
            date,
            availableCount: rt.inventory,
            rateCents: rt.baseRateCents,
          },
        });
      }
    }
  }

  const harbor = await db.property.findUnique({ where: { slug: "the-harbor-house" } });
  const harborRoom = await db.roomType.findFirst({ where: { propertyId: harbor!.id } });

  const checkIn = addDays(new Date(), 14);
  const checkOut = addDays(new Date(), 16);
  checkIn.setHours(0, 0, 0, 0);
  checkOut.setHours(0, 0, 0, 0);

  const pastCheckIn = subDays(new Date(), 10);
  const pastCheckOut = subDays(new Date(), 8);

  const upcoming = await db.booking.create({
    data: {
      confirmationCode: "HVN-DEMO01",
      userId: traveler.id,
      propertyId: harbor!.id,
      status: BookingStatus.CONFIRMED,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      guestCount: 2,
      roomTotalCents: 37800,
      taxesFeesCents: 4914,
      totalCents: 42714,
      commissionCents: 5670,
      policySnapshot: JSON.stringify({
        template: "MODERATE",
        description: "Moderate policy",
        fullRefundUntil: subDays(checkIn, 5).toISOString(),
        partialRefundUntil: addDays(checkIn, -1).toISOString(),
        partialRefundPercent: 50,
      }),
      guestName: "Alex Traveler",
      guestEmail: traveler.email,
      lines: {
        create: {
          roomTypeId: harborRoom!.id,
          quantity: 1,
          nights: 2,
          ratePerNightCents: 18900,
        },
      },
      payment: {
        create: {
          amountCents: 42714,
          status: PaymentStatus.SUCCEEDED,
          stripePaymentIntentId: "mock_pi_demo01",
          capturedAt: new Date(),
        },
      },
    },
  });

  await db.booking.create({
    data: {
      confirmationCode: "HVN-DEMO02",
      userId: traveler.id,
      propertyId: harbor!.id,
      status: BookingStatus.COMPLETED,
      checkInDate: pastCheckIn,
      checkOutDate: pastCheckOut,
      guestCount: 2,
      roomTotalCents: 37800,
      taxesFeesCents: 4914,
      totalCents: 42714,
      commissionCents: 5670,
      policySnapshot: "{}",
      guestName: "Alex Traveler",
      guestEmail: traveler.email,
      lines: {
        create: {
          roomTypeId: harborRoom!.id,
          quantity: 1,
          nights: 2,
          ratePerNightCents: 18900,
        },
      },
      payment: {
        create: {
          amountCents: 42714,
          status: PaymentStatus.SUCCEEDED,
          stripePaymentIntentId: "mock_pi_demo02",
          capturedAt: pastCheckIn,
        },
      },
    },
  });

  console.log("Seed complete!");
  console.log("Demo accounts (password: demo1234):");
  console.log("  traveler@havenstay.demo");
  console.log("  hotel@havenstay.demo");
  console.log("  admin@havenstay.demo");
  console.log(`Upcoming booking: ${upcoming.confirmationCode}`);
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
