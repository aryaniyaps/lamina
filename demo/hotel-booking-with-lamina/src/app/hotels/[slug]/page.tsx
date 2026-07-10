import { notFound } from "next/navigation";
import Link from "next/link";
import { addDays, format } from "date-fns";
import { TravelerHeader } from "@/components/traveler-header";
import { SearchForm } from "@/components/search-form";
import { Badge } from "@/components/property-card";
import { getPropertyBySlug } from "@/lib/search";
import { getAvailableCount, getNightlyRates } from "@/lib/inventory";
import { CANCELLATION_TEMPLATES, AMENITIES } from "@/lib/constants";
import { formatCents, parseJsonArray, startOfDay, eachNight } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HotelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    checkIn?: string;
    checkOut?: string;
    guests?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const property = await getPropertyBySlug(slug);
  if (!property || property.status !== "LIVE") notFound();

  const today = format(new Date(), "yyyy-MM-dd");
  const checkIn = sp.checkIn ?? today;
  const checkOut = sp.checkOut ?? format(addDays(new Date(), 1), "yyyy-MM-dd");
  const guests = Number(sp.guests ?? "2");

  const checkInDate = startOfDay(new Date(checkIn));
  const checkOutDate = startOfDay(new Date(checkOut));
  const nights = eachNight(checkInDate, checkOutDate);

  const photos = parseJsonArray(property.photos);
  const amenities = parseJsonArray(property.amenities);
  const policy = property.cancellationPolicy;

  const roomsWithAvailability = await Promise.all(
    property.roomTypes.map(async (room) => {
      if (room.maxOccupancy < guests) {
        return { room, available: false, totalCents: 0, nightlyAvg: 0 };
      }

      let available = true;
      for (const night of nights) {
        const count = await getAvailableCount(room.id, night, room.totalInventoryCount);
        if (count < 1) {
          available = false;
          break;
        }
      }

      const rates = await getNightlyRates(room.id, checkInDate, checkOutDate, room.baseRateCents);
      const totalCents = rates.reduce((s, r) => s + r.rateCents, 0);
      const nightlyAvg = nights.length > 0 ? Math.round(totalCents / nights.length) : room.baseRateCents;

      return { room, available, totalCents, nightlyAvg };
    }),
  );

  const checkoutBase = new URLSearchParams({
    propertyId: property.id,
    checkIn,
    checkOut,
    guestCount: String(guests),
  });

  return (
    <>
      <TravelerHeader />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6">
          <SearchForm
            defaultCity={property.city}
            defaultCheckIn={checkIn}
            defaultCheckOut={checkOut}
            defaultGuests={String(guests)}
            compact
          />
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="overflow-hidden rounded-2xl">
              <div className="grid gap-2 md:grid-cols-2">
                {photos.slice(0, 4).map((photo, i) => (
                  <div
                    key={i}
                    className={`bg-cover bg-center ${i === 0 ? "md:col-span-2 md:h-80 h-56" : "h-40"}`}
                    style={{ backgroundImage: `url(${photo})` }}
                  />
                ))}
              </div>
            </div>

            <div className="mt-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold text-stone-900">{property.name}</h1>
                  <p className="mt-1 text-stone-500">
                    {property.city}, {property.state} · {property.starRating}-star boutique hotel
                  </p>
                </div>
                {property.reviewCount > 0 && (
                  <div className="rounded-xl bg-brand-50 px-4 py-2 text-center">
                    <div className="text-2xl font-bold text-brand-600">
                      {property.averageRating.toFixed(1)}
                    </div>
                    <div className="text-xs text-stone-500">
                      {property.reviewCount} {property.reviewCount === 1 ? "review" : "reviews"}
                    </div>
                  </div>
                )}
              </div>

              <p className="mt-6 leading-relaxed text-stone-700">{property.description}</p>

              {amenities.length > 0 && (
                <div className="mt-8">
                  <h2 className="text-lg font-semibold">Amenities</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {amenities.map((a) => (
                      <Badge key={a}>{AMENITIES.includes(a) ? a : a}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {property.houseRules && (
                <div className="mt-8">
                  <h2 className="text-lg font-semibold">House rules</h2>
                  <p className="mt-2 text-sm text-stone-600">{property.houseRules}</p>
                </div>
              )}
            </div>

            <div className="mt-10">
              <h2 className="text-xl font-semibold">Available rooms</h2>
              <p className="mt-1 text-sm text-stone-500">
                {format(checkInDate, "MMM d")} – {format(checkOutDate, "MMM d")} · {guests}{" "}
                {guests === 1 ? "guest" : "guests"} · {nights.length}{" "}
                {nights.length === 1 ? "night" : "nights"}
              </p>

              <div className="mt-4 space-y-4">
                {roomsWithAvailability.map(({ room, available, totalCents, nightlyAvg }) => {
                  const roomPhotos = parseJsonArray(room.photos);
                  const qs = new URLSearchParams(checkoutBase);
                  qs.set("roomTypeId", room.id);

                  return (
                    <div
                      key={room.id}
                      className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5 sm:flex-row"
                    >
                      <div
                        className="h-32 w-full shrink-0 rounded-xl bg-cover bg-center sm:w-40"
                        style={{ backgroundImage: `url(${roomPhotos[0] ?? photos[0] ?? ""})` }}
                      />
                      <div className="flex flex-1 flex-col justify-between">
                        <div>
                          <h3 className="font-semibold">{room.name}</h3>
                          <p className="mt-1 text-sm text-stone-500">{room.description}</p>
                          <p className="mt-2 text-sm text-stone-600">
                            {room.bedConfiguration} · Up to {room.maxOccupancy} guests
                          </p>
                        </div>
                        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                          <div>
                            <span className="text-lg font-semibold">{formatCents(nightlyAvg)}</span>
                            <span className="text-sm text-stone-500"> / night</span>
                            {nights.length > 1 && (
                              <p className="text-sm text-stone-500">
                                {formatCents(totalCents)} total
                              </p>
                            )}
                          </div>
                          {available ? (
                            <Link
                              href={`/checkout?${qs}`}
                              className="rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
                            >
                              Book now
                            </Link>
                          ) : (
                            <span className="rounded-xl bg-stone-100 px-4 py-2.5 text-sm text-stone-500">
                              Sold out
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {property.reviews.length > 0 && (
              <div className="mt-12">
                <h2 className="text-xl font-semibold">Guest reviews</h2>
                <div className="mt-4 space-y-4">
                  {property.reviews.map((review) => (
                    <div
                      key={review.id}
                      className="rounded-2xl border border-stone-200 bg-white p-5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{review.user.name}</span>
                        <span className="rounded-lg bg-brand-50 px-2 py-1 text-sm font-medium text-brand-600">
                          {review.overallRating}/5
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-stone-700">{review.bodyText}</p>
                      {review.hotelResponse && (
                        <div className="mt-3 rounded-xl bg-stone-50 p-3 text-sm">
                          <span className="font-medium text-stone-700">Hotel response: </span>
                          {review.hotelResponse}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="lg:col-span-1">
            <div className="sticky top-8 space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
              <h2 className="font-semibold">Property details</h2>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-stone-500">Address</dt>
                  <dd className="font-medium">
                    {property.addressLine1}
                    <br />
                    {property.city}, {property.state} {property.zip}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">Check-in</dt>
                  <dd className="font-medium">{property.checkInTime}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">Check-out</dt>
                  <dd className="font-medium">{property.checkOutTime}</dd>
                </div>
              </dl>

              {policy && (
                <div className="border-t border-stone-100 pt-4">
                  <h3 className="font-medium">Cancellation policy</h3>
                  <p className="mt-1 text-sm font-medium text-brand-600">
                    {CANCELLATION_TEMPLATES[policy.template].label}
                  </p>
                  <p className="mt-1 text-sm text-stone-600">{policy.description}</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
