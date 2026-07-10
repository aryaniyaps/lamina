import Link from "next/link";
import Image from "next/image";
import { Star, MapPin } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type HotelCardProps = {
  slug: string;
  name: string;
  city: string;
  country: string;
  photos: string[];
  rating: number;
  reviewCount: number;
  lowestPrice: number;
  amenities?: string[];
};

export function HotelCard({
  slug,
  name,
  city,
  country,
  photos,
  rating,
  reviewCount,
  lowestPrice,
  amenities = [],
}: HotelCardProps) {
  const photo = photos[0] ?? "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800";

  return (
    <Link
      href={`/hotels/${slug}`}
      className="group grid overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-lg md:grid-cols-[280px_1fr]"
    >
      <div className="relative aspect-[4/3] md:aspect-auto md:min-h-[200px]">
        <Image
          src={photo}
          alt={name}
          fill
          className="object-cover transition-transform group-hover:scale-105"
          sizes="280px"
        />
      </div>
      <div className="flex flex-col justify-between p-5">
        <div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-foreground group-hover:text-teal-800">
                {name}
              </h3>
              <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {city}, {country}
              </p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
                <span className="font-semibold">{rating.toFixed(1)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{reviewCount} reviews</p>
            </div>
          </div>
          {amenities.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {amenities.slice(0, 4).map((a) => (
                <Badge key={a} variant="outline">
                  {a}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4 flex items-end justify-between">
          <p className="text-sm text-muted-foreground">Free cancellation</p>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">from</p>
            <p className="font-display text-xl font-semibold text-teal-800">
              {formatCurrency(lowestPrice)}
              <span className="text-sm font-normal text-muted-foreground"> / stay</span>
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}
