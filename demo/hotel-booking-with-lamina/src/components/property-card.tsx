import Link from "next/link";
import { cn, formatCents, parseJsonArray } from "@/lib/utils";

export function PropertyCard({
  property,
  checkIn,
  checkOut,
  guests,
  fromPriceCents,
}: {
  property: {
    slug: string;
    name: string;
    city: string;
    state: string;
    photos: string;
    averageRating: number;
    reviewCount: number;
  };
  checkIn?: string;
  checkOut?: string;
  guests?: string;
  fromPriceCents?: number;
}) {
  const photos = parseJsonArray(property.photos);
  const qs = new URLSearchParams();
  if (checkIn) qs.set("checkIn", checkIn);
  if (checkOut) qs.set("checkOut", checkOut);
  if (guests) qs.set("guests", guests);
  const href = `/hotels/${property.slug}${qs.toString() ? `?${qs}` : ""}`;

  return (
    <Link
      href={href}
      className="group overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:shadow-md"
    >
      <div
        className="h-48 bg-cover bg-center"
        style={{ backgroundImage: `url(${photos[0] ?? ""})` }}
      />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold group-hover:text-brand-600">{property.name}</h3>
            <p className="text-sm text-stone-500">
              {property.city}, {property.state}
            </p>
          </div>
          {property.reviewCount > 0 && (
            <span className="rounded-lg bg-brand-50 px-2 py-1 text-sm font-medium text-brand-600">
              {property.averageRating.toFixed(1)}
            </span>
          )}
        </div>
        {fromPriceCents !== undefined && (
          <p className="mt-3 text-sm">
            <span className="font-semibold">{formatCents(fromPriceCents)}</span>
            <span className="text-stone-500"> / night</span>
          </p>
        )}
      </div>
    </Link>
  );
}

export function Badge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
        variant === "default" && "bg-stone-100 text-stone-700",
        variant === "success" && "bg-green-100 text-green-800",
        variant === "warning" && "bg-amber-100 text-amber-800",
        variant === "danger" && "bg-red-100 text-red-800",
      )}
    >
      {children}
    </span>
  );
}
