"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function HoldTimer({
  expiresAt,
  propertySlug,
}: {
  expiresAt: string;
  propertySlug?: string;
}) {
  const expiry = new Date(expiresAt).getTime();
  const [remaining, setRemaining] = useState(() => Math.max(0, expiry - Date.now()));
  const expired = remaining <= 0;

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, expiry - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiry]);

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        expired
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {expired ? (
        <>
          <p className="font-medium">Your room hold has expired</p>
          <p className="mt-1 text-sm">
            This room may no longer be available.{" "}
            {propertySlug ? (
              <Link href={`/hotels/${propertySlug}`} className="font-medium underline">
                Return to the hotel
              </Link>
            ) : (
              <Link href="/search" className="font-medium underline">
                Search again
              </Link>
            )}{" "}
            to check availability.
          </p>
        </>
      ) : (
        <>
          <p className="font-medium">
            Room held for you —{" "}
            <span className="font-mono tabular-nums">{formatRemaining(remaining)}</span> remaining
          </p>
          <p className="mt-1 text-sm opacity-90">
            Complete payment before the timer runs out to secure this rate.
          </p>
        </>
      )}
    </div>
  );
}
