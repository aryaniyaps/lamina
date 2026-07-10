import { PropertyStatus } from "@prisma/client";
import { TravelerHeader } from "@/components/traveler-header";
import { SearchForm } from "@/components/search-form";
import { PropertyCard } from "@/components/property-card";
import { db } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const featured = await db.property.findMany({
    where: { status: PropertyStatus.LIVE },
    include: { roomTypes: true },
    orderBy: [{ averageRating: "desc" }, { reviewCount: "desc" }],
    take: 6,
  });

  return (
    <>
      <TravelerHeader />
      <main>
        <section className="bg-gradient-to-b from-brand-50 to-stone-50 px-4 py-16 md:py-24">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-brand-700 md:text-5xl">
              Boutique stays, thoughtfully booked
            </h1>
            <p className="mt-4 text-lg text-stone-600">
              Discover independent hotels across the United States — curated for comfort,
              character, and trust.
            </p>
            <div className="mt-10">
              <SearchForm />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16">
          <div className="mb-8 flex items-end justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-stone-900">Featured properties</h2>
              <p className="mt-1 text-stone-500">Top-rated boutique hotels on HavenStay</p>
            </div>
            <Link href="/search" className="text-sm font-medium text-brand-600 hover:text-brand-700">
              View all →
            </Link>
          </div>
          {featured.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-12 text-center">
              <p className="text-stone-500">No properties available yet. Check back soon.</p>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((property) => (
                <PropertyCard
                  key={property.id}
                  property={property}
                  fromPriceCents={
                    property.roomTypes.length > 0
                      ? Math.min(...property.roomTypes.map((r) => r.baseRateCents))
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </section>

        <section className="border-t border-stone-200 bg-white px-4 py-16">
          <div className="mx-auto max-w-7xl text-center">
            <h2 className="text-2xl font-semibold">Own a boutique hotel?</h2>
            <p className="mx-auto mt-2 max-w-xl text-stone-600">
              Join HavenStay and reach travelers looking for unique, independent stays.
            </p>
            <Link
              href="/list-your-property"
              className="mt-6 inline-block rounded-full bg-brand-600 px-8 py-3 font-medium text-white hover:bg-brand-700"
            >
              List your property
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
