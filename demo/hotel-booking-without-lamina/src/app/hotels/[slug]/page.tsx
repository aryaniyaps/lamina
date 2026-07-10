import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getHotelBySlug } from "@/lib/search";
import { calculateRoomPrice } from "@/lib/availability";
import { formatCurrency } from "@/lib/utils";
import { formatDateRange, getDefaultSearchDates } from "@/lib/dates";
import { parseISO } from "date-fns";
import { Star, MapPin, Clock, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ checkIn?: string; checkOut?: string; guests?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const hotel = await getHotelBySlug(slug);
  return { title: hotel?.name ?? "Hotel" };
}

export default async function HotelDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const defaults = getDefaultSearchDates();
  const checkIn = sp.checkIn ?? defaults.checkIn;
  const checkOut = sp.checkOut ?? defaults.checkOut;
  const guests = Number(sp.guests ?? 2);

  const hotel = await getHotelBySlug(slug);
  if (!hotel || hotel.status !== "PUBLISHED") notFound();

  const roomPrices = await Promise.all(
    hotel.roomTypes
      .filter((r) => r.capacity >= guests)
      .map(async (room) => {
        const price = await calculateRoomPrice({
          roomTypeId: room.id,
          checkIn: parseISO(checkIn),
          checkOut: parseISO(checkOut),
        });
        return { room, price };
      })
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="grid gap-2 md:grid-cols-4 md:grid-rows-2">
        <div className="relative aspect-[16/10] md:col-span-2 md:row-span-2 md:aspect-auto md:min-h-[400px]">
          <Image
            src={hotel.photos[0] ?? "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200"}
            alt={hotel.name}
            fill
            className="rounded-xl object-cover"
            priority
          />
        </div>
        {hotel.photos.slice(1, 3).map((photo, i) => (
          <div key={i} className="relative hidden aspect-[4/3] md:block">
            <Image src={photo} alt="" fill className="rounded-xl object-cover" />
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-4xl font-bold">{hotel.name}</h1>
              <p className="mt-2 flex items-center gap-1 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {hotel.address}, {hotel.city}, {hotel.country}
              </p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1">
                <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
                <span className="text-lg font-semibold">{hotel.rating.toFixed(1)}</span>
              </div>
              <p className="text-sm text-muted-foreground">{hotel.reviewCount} reviews</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {hotel.amenities.map((a) => (
              <Badge key={a} variant="outline">{a}</Badge>
            ))}
          </div>

          <p className="mt-6 leading-relaxed text-foreground/90">{hotel.description}</p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="flex gap-3 rounded-lg border border-border p-4">
              <Clock className="h-5 w-5 text-teal-700" />
              <div>
                <p className="font-medium">Check-in / Check-out</p>
                <p className="text-sm text-muted-foreground">
                  {hotel.checkInTime} / {hotel.checkOutTime}
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border border-border p-4">
              <Shield className="h-5 w-5 text-teal-700" />
              <div>
                <p className="font-medium">Cancellation</p>
                <p className="text-sm text-muted-foreground">{hotel.cancellationPolicy}</p>
              </div>
            </div>
          </div>

          <section className="mt-10">
            <h2 className="font-display text-2xl font-bold">Available rooms</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatDateRange(checkIn, checkOut)} · {guests} guests
            </p>
            <div className="mt-4 space-y-4">
              {roomPrices.map(({ room, price }) => (
                <div
                  key={room.id}
                  className="flex flex-col gap-4 rounded-xl border border-border p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <h3 className="font-semibold">{room.name}</h3>
                    <p className="text-sm text-muted-foreground">{room.beds} · Up to {room.capacity} guests</p>
                    <p className="mt-2 text-sm">{room.description}</p>
                  </div>
                  <div className="text-right">
                    {price ? (
                      <>
                        <p className="font-display text-2xl font-bold text-teal-800">
                          {formatCurrency(price.subtotal)}
                        </p>
                        <p className="text-xs text-muted-foreground">{price.nights} nights total</p>
                        <Link
                          href={`/hotels/${slug}/book?roomTypeId=${room.id}&checkIn=${checkIn}&checkOut=${checkOut}&guests=${guests}`}
                        >
                          <Button variant="accent" className="mt-3 w-full sm:w-auto">
                            Reserve
                          </Button>
                        </Link>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not available</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {hotel.reviews.length > 0 && (
            <section className="mt-10">
              <h2 className="font-display text-2xl font-bold">Guest reviews</h2>
              <div className="mt-4 space-y-4">
                {hotel.reviews.map((review) => (
                  <div key={review.id} className="rounded-xl border border-border p-5">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{review.user.name ?? "Guest"}</p>
                      <div className="flex items-center gap-1">
                        <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                        {review.rating}
                      </div>
                    </div>
                    {review.title && <p className="mt-2 font-medium">{review.title}</p>}
                    <p className="mt-1 text-sm text-muted-foreground">{review.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">Your dates</p>
            <p className="font-medium">{formatDateRange(checkIn, checkOut)}</p>
            <p className="mt-1 text-sm">{guests} guests</p>
            <Link href={`/search?location=${hotel.city}&checkIn=${checkIn}&checkOut=${checkOut}&guests=${guests}`}>
              <Button variant="outline" className="mt-4 w-full">Change dates</Button>
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
