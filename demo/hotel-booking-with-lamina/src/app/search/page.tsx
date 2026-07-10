import { TravelerHeader } from "@/components/traveler-header";
import { SearchForm } from "@/components/search-form";
import { PropertyCard } from "@/components/property-card";
import { searchProperties } from "@/lib/search";
import { startOfDay } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    city?: string;
    checkIn?: string;
    checkOut?: string;
    guests?: string;
    minPrice?: string;
    maxPrice?: string;
    minRating?: string;
  }>;
}) {
  const params = await searchParams;
  const city = params.city ?? "";
  const checkIn = params.checkIn;
  const checkOut = params.checkOut;
  const guests = params.guests ?? "2";
  const minPrice = params.minPrice ? Number(params.minPrice) : undefined;
  const maxPrice = params.maxPrice ? Number(params.maxPrice) : undefined;
  const minRating = params.minRating ? Number(params.minRating) : undefined;

  const results = await searchProperties({
    city: city || undefined,
    checkIn: checkIn ? startOfDay(new Date(checkIn)) : undefined,
    checkOut: checkOut ? startOfDay(new Date(checkOut)) : undefined,
    guests: Number(guests),
    minPrice,
    maxPrice,
    minRating,
  });

  const filterQs = new URLSearchParams();
  if (city) filterQs.set("city", city);
  if (checkIn) filterQs.set("checkIn", checkIn);
  if (checkOut) filterQs.set("checkOut", checkOut);
  if (guests) filterQs.set("guests", guests);

  return (
    <>
      <TravelerHeader />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8">
          <SearchForm
            defaultCity={city}
            defaultCheckIn={checkIn}
            defaultCheckOut={checkOut}
            defaultGuests={guests}
            compact
          />
        </div>

        <div className="flex flex-col gap-8 lg:flex-row">
          <aside className="lg:w-64 lg:shrink-0">
            <form method="get" className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
              <h2 className="font-semibold text-stone-900">Filters</h2>
              <input type="hidden" name="city" value={city} />
              <input type="hidden" name="checkIn" value={checkIn ?? ""} />
              <input type="hidden" name="checkOut" value={checkOut ?? ""} />
              <input type="hidden" name="guests" value={guests} />

              <div>
                <label htmlFor="minPrice" className="block text-sm font-medium text-stone-700">
                  Min price / night ($)
                </label>
                <input
                  id="minPrice"
                  name="minPrice"
                  type="number"
                  min={0}
                  defaultValue={params.minPrice ?? ""}
                  placeholder="50"
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="maxPrice" className="block text-sm font-medium text-stone-700">
                  Max price / night ($)
                </label>
                <input
                  id="maxPrice"
                  name="maxPrice"
                  type="number"
                  min={0}
                  defaultValue={params.maxPrice ?? ""}
                  placeholder="500"
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="minRating" className="block text-sm font-medium text-stone-700">
                  Minimum rating
                </label>
                <select
                  id="minRating"
                  name="minRating"
                  defaultValue={params.minRating ?? ""}
                  className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
                >
                  <option value="">Any</option>
                  <option value="3">3+ stars</option>
                  <option value="4">4+ stars</option>
                  <option value="4.5">4.5+ stars</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Apply filters
              </button>
              {(params.minPrice || params.maxPrice || params.minRating) && (
                <Link
                  href={`/search?${filterQs}`}
                  className="block text-center text-sm text-stone-500 hover:text-brand-600"
                >
                  Clear filters
                </Link>
              )}
            </form>
          </aside>

          <div className="flex-1">
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-xl font-semibold">
                {city ? `Stays in ${city}` : "All properties"}
              </h1>
              <span className="text-sm text-stone-500">
                {results.length} {results.length === 1 ? "property" : "properties"}
              </span>
            </div>

            {results.length === 0 ? (
              <div className="rounded-2xl border border-stone-200 bg-white p-12 text-center">
                <h2 className="text-lg font-semibold text-stone-900">No matches found</h2>
                <p className="mt-2 text-stone-500">
                  Try adjusting your dates, destination, or filters to see more options.
                </p>
                <Link
                  href="/search"
                  className="mt-6 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  Clear search
                </Link>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {results.map(({ property, fromPriceCents }) => (
                  <PropertyCard
                    key={property.id}
                    property={property}
                    checkIn={checkIn}
                    checkOut={checkOut}
                    guests={guests}
                    fromPriceCents={fromPriceCents}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
