"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { MapPin, Calendar, Users, Search } from "lucide-react";
import { getDefaultSearchDates } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function SearchBar({
  variant = "hero",
  className,
}: {
  variant?: "hero" | "compact";
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaults = getDefaultSearchDates();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    const location = form.get("location") as string;
    const checkIn = form.get("checkIn") as string;
    const checkOut = form.get("checkOut") as string;
    const guests = form.get("guests") as string;

    if (location) params.set("location", location);
    if (checkIn) params.set("checkIn", checkIn);
    if (checkOut) params.set("checkOut", checkOut);
    if (guests) params.set("guests", guests);

    router.push(`/search?${params.toString()}`);
  };

  const isHero = variant === "hero";

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "grid gap-3",
        isHero
          ? "rounded-2xl bg-white/95 p-4 shadow-2xl backdrop-blur-sm md:grid-cols-[1.5fr_1fr_1fr_auto_auto] md:items-end"
          : "rounded-xl border border-border bg-white p-4 md:grid-cols-[1.5fr_1fr_1fr_auto_auto] md:items-end",
        className
      )}
    >
      <div className="space-y-1.5">
        <label htmlFor="location" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          Destination
        </label>
        <input
          id="location"
          name="location"
          type="text"
          placeholder="City, hotel, or region"
          defaultValue={searchParams.get("location") ?? ""}
          className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-teal-600"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="checkIn" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" aria-hidden />
          Check-in
        </label>
        <input
          id="checkIn"
          name="checkIn"
          type="date"
          required
          min={new Date().toISOString().split("T")[0]}
          defaultValue={searchParams.get("checkIn") ?? defaults.checkIn}
          className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-teal-600"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="checkOut" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" aria-hidden />
          Check-out
        </label>
        <input
          id="checkOut"
          name="checkOut"
          type="date"
          required
          defaultValue={searchParams.get("checkOut") ?? defaults.checkOut}
          className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-teal-600"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="guests" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Users className="h-3.5 w-3.5" aria-hidden />
          Guests
        </label>
        <select
          id="guests"
          name="guests"
          defaultValue={searchParams.get("guests") ?? "2"}
          className="w-full rounded-lg border border-border px-3 py-2.5 text-sm focus:border-teal-600"
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n} guest{n > 1 ? "s" : ""}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" variant="accent" size="lg" className="md:self-end">
        <Search className="h-4 w-4" aria-hidden />
        Search
      </Button>
    </form>
  );
}
