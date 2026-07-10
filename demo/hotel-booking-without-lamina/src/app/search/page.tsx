import { Suspense } from "react";
import { searchHotels } from "@/lib/search";
import { HotelCard } from "@/components/hotels/hotel-card";
import { SearchBar } from "@/components/search/search-bar";
import { getDefaultSearchDates } from "@/lib/dates";

type Props = {
  searchParams: Promise<{
    location?: string;
    checkIn?: string;
    checkOut?: string;
    guests?: string;
    minPrice?: string;
    maxPrice?: string;
    minRating?: string;
    sort?: string;
    amenities?: string;
  }>;
};

export const metadata = { title: "Search hotels" };

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const defaults = getDefaultSearchDates();

  const hotels = await searchHotels({
    location: params.location,
    checkIn: params.checkIn ?? defaults.checkIn,
    checkOut: params.checkOut ?? defaults.checkOut,
    guests: params.guests ? Number(params.guests) : 2,
    minPrice: params.minPrice ? Number(params.minPrice) * 100 : undefined,
    maxPrice: params.maxPrice ? Number(params.maxPrice) * 100 : undefined,
    minRating: params.minRating ? Number(params.minRating) : undefined,
    sort: (params.sort as "recommended" | "price_asc" | "price_desc" | "rating") ?? "recommended",
    amenities: params.amenities ? params.amenities.split(",") : [],
  }).catch(() => []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl font-bold">Search stays</h1>
      <div className="mt-6">
        <Suspense>
          <SearchBar variant="compact" />
        </Suspense>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-4">
          <form className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold">Filters</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                Min rating
                <select name="minRating" defaultValue={params.minRating ?? ""} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm">
                  <option value="">Any</option>
                  <option value="4">4+ stars</option>
                  <option value="4.5">4.5+ stars</option>
                </select>
              </label>
              <label className="block text-sm">
                Sort by
                <select name="sort" defaultValue={params.sort ?? "recommended"} className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm">
                  <option value="recommended">Recommended</option>
                  <option value="price_asc">Price: low to high</option>
                  <option value="price_desc">Price: high to low</option>
                  <option value="rating">Rating</option>
                </select>
              </label>
            </div>
          </form>
          <div className="hidden rounded-xl border border-dashed border-border bg-muted/50 p-4 lg:block">
            <p className="text-sm font-medium text-muted-foreground">Map view</p>
            <p className="mt-1 text-xs text-muted-foreground">Coming soon — layout ready for map integration</p>
          </div>
        </aside>

        <div>
          <p className="text-sm text-muted-foreground">
            {hotels.length} {hotels.length === 1 ? "property" : "properties"} found
            {params.location && ` in ${params.location}`}
          </p>
          <div className="mt-4 space-y-4">
            {hotels.length > 0 ? (
              hotels.map((hotel) => (
                <HotelCard
                  key={hotel.id}
                  slug={hotel.slug}
                  name={hotel.name}
                  city={hotel.city}
                  country={hotel.country}
                  photos={hotel.photos}
                  rating={hotel.rating}
                  reviewCount={hotel.reviewCount}
                  lowestPrice={hotel.lowestPrice}
                  amenities={hotel.amenities}
                />
              ))
            ) : (
              <div className="rounded-xl border border-border bg-card p-12 text-center">
                <p className="font-display text-xl font-semibold">No stays found</p>
                <p className="mt-2 text-muted-foreground">
                  Try adjusting your dates, destination, or filters.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
