"use client";

import { useRouter } from "next/navigation";
import { FormEvent } from "react";
import { addDays, format } from "date-fns";

export function SearchForm({
  defaultCity = "",
  defaultCheckIn,
  defaultCheckOut,
  defaultGuests = "2",
  compact = false,
}: {
  defaultCity?: string;
  defaultCheckIn?: string;
  defaultCheckOut?: string;
  defaultGuests?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const today = format(new Date(), "yyyy-MM-dd");
  const checkIn = defaultCheckIn || today;
  const checkOut = defaultCheckOut || format(addDays(new Date(), 1), "yyyy-MM-dd");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams();
    params.set("city", String(fd.get("city")));
    params.set("checkIn", String(fd.get("checkIn")));
    params.set("checkOut", String(fd.get("checkOut")));
    params.set("guests", String(fd.get("guests")));
    router.push(`/search?${params}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      className={
        compact
          ? "flex flex-wrap gap-2"
          : "grid gap-3 rounded-2xl bg-white p-4 shadow-lg md:grid-cols-5"
      }
    >
      <input
        name="city"
        defaultValue={defaultCity}
        placeholder="City or hotel"
        required
        className="rounded-xl border border-stone-200 px-4 py-3 md:col-span-2"
      />
      <input
        name="checkIn"
        type="date"
        defaultValue={checkIn}
        min={today}
        required
        className="rounded-xl border border-stone-200 px-4 py-3"
      />
      <input
        name="checkOut"
        type="date"
        defaultValue={checkOut}
        required
        className="rounded-xl border border-stone-200 px-4 py-3"
      />
      <div className="flex gap-2">
        <input
          name="guests"
          type="number"
          min={1}
          max={10}
          defaultValue={defaultGuests}
          className="w-full rounded-xl border border-stone-200 px-4 py-3"
        />
        <button
          type="submit"
          className="whitespace-nowrap rounded-xl bg-brand-600 px-6 py-3 font-medium text-white hover:bg-brand-700"
        >
          Search
        </button>
      </div>
    </form>
  );
}
