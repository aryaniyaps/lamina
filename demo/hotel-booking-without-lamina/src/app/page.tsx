import Image from "next/image";
import { Suspense } from "react";
import { SearchBar } from "@/components/search/search-bar";
import { getPopularDestinations } from "@/lib/search";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default async function HomePage() {
  const destinations = await getPopularDestinations().catch(() => []);

  return (
    <>
      <section className="hero-gradient relative min-h-[85vh] overflow-hidden text-white">
        <div className="absolute inset-0 opacity-30">
          <Image
            src="https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=1600"
            alt=""
            fill
            className="object-cover"
            priority
          />
        </div>
        <div className="relative mx-auto flex max-w-7xl flex-col justify-center px-4 py-20 sm:px-6 lg:min-h-[85vh] lg:py-28">
          <div className="max-w-2xl animate-fade-up">
            <p className="text-sm font-medium uppercase tracking-widest text-teal-200">
              Coastal hospitality, reimagined
            </p>
            <h1 className="font-display mt-4 text-5xl font-bold leading-tight md:text-6xl lg:text-7xl">
              Find your perfect stay, effortlessly
            </h1>
            <p className="mt-6 text-lg text-teal-100/90">
              Compare trusted hotels, book with confidence, and manage every detail of your trip in one place.
            </p>
          </div>
          <div className="mt-10 max-w-5xl animate-fade-up-delay">
            <Suspense fallback={<div className="h-24 rounded-2xl bg-white/20" />}>
              <SearchBar variant="hero" />
            </Suspense>
          </div>
        </div>
      </section>

      <section className="mist-surface py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-display text-3xl font-bold text-foreground">
                Popular destinations
              </h2>
              <p className="mt-2 text-muted-foreground">
                Explore top cities travelers love
              </p>
            </div>
            <Link
              href="/search"
              className="hidden items-center gap-1 text-sm font-medium text-teal-800 hover:underline md:flex"
            >
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {destinations.length > 0 ? (
              destinations.map((d) => (
                <Link
                  key={`${d.city}-${d.country}`}
                  href={`/search?location=${encodeURIComponent(d.city)}`}
                  className="group relative overflow-hidden rounded-xl"
                >
                  <div className="relative aspect-[16/10]">
                    <Image
                      src={`https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=600&sig=${d.city}`}
                      alt={d.city}
                      fill
                      className="object-cover transition-transform group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-teal-950/80 to-transparent" />
                    <div className="absolute bottom-4 left-4 text-white">
                      <p className="font-display text-xl font-semibold">{d.city}</p>
                      <p className="text-sm text-teal-100">{d.country} · {d.hotelCount} hotels</p>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              ["Bali", "Tokyo", "Barcelona", "New York", "Dubai", "Sydney"].map((city) => (
                <Link
                  key={city}
                  href={`/search?location=${city}`}
                  className="rounded-xl border border-border bg-card p-6 transition-shadow hover:shadow-md"
                >
                  <p className="font-display text-xl font-semibold">{city}</p>
                  <p className="text-sm text-muted-foreground">Explore stays</p>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-white py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <h2 className="font-display text-center text-3xl font-bold">Why HavenStay</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              {
                title: "Transparent pricing",
                body: "See the full cost upfront — taxes, fees, and nightly rates with no surprises at checkout.",
              },
              {
                title: "Flexible cancellation",
                body: "Clear policies on every listing. Cancel within policy windows for full or partial refunds.",
              },
              {
                title: "Trusted reviews",
                body: "Verified guest reviews help you choose with confidence. Only guests who stayed can review.",
              },
            ].map((item) => (
              <div key={item.title} className="text-center">
                <h3 className="font-display text-xl font-semibold text-teal-900">{item.title}</h3>
                <p className="mt-3 text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
