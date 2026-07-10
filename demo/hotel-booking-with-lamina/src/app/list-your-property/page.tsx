import Link from "next/link";
import { TravelerHeader } from "@/components/traveler-header";

const benefits = [
  {
    title: "Reach discerning travelers",
    description:
      "Connect with guests seeking boutique, independent hotels — not generic chain experiences.",
  },
  {
    title: "Simple self-serve onboarding",
    description:
      "List your property, set rates, and go live in days with our guided setup wizard.",
  },
  {
    title: "Transparent commission",
    description:
      "Pay only when you earn. No hidden fees, no long-term contracts.",
  },
  {
    title: "You stay in control",
    description:
      "Manage inventory, pricing, and reservations from your own dashboard.",
  },
];

export default function ListYourPropertyPage() {
  return (
    <>
      <TravelerHeader />
      <main>
        <section className="bg-gradient-to-b from-brand-50 to-stone-50 px-4 py-16 md:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl font-bold tracking-tight text-brand-700 md:text-5xl">
              List your boutique hotel on HavenStay
            </h1>
            <p className="mt-4 text-lg text-stone-600">
              Join independent hotels across the US reaching travelers who value character,
              quality, and trust.
            </p>
            <Link
              href="/hotel/sign-up"
              className="mt-8 inline-block rounded-full bg-brand-600 px-10 py-4 text-lg font-medium text-white hover:bg-brand-700"
            >
              Get started — it&apos;s free
            </Link>
            <p className="mt-4 text-sm text-stone-500">
              Already a partner?{" "}
              <Link href="/hotel" className="text-brand-600 hover:text-brand-700">
                Sign in to your dashboard
              </Link>
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-center text-2xl font-semibold">Why HavenStay?</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {benefits.map((b) => (
              <div
                key={b.title}
                className="rounded-2xl border border-stone-200 bg-white p-6"
              >
                <h3 className="font-semibold text-brand-600">{b.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{b.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-stone-200 bg-white px-4 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold">Ready to welcome guests?</h2>
            <p className="mt-2 text-stone-600">
              Create your hotel account and complete our self-serve onboarding in under an hour.
            </p>
            <Link
              href="/hotel/sign-up"
              className="mt-6 inline-block rounded-full bg-brand-600 px-8 py-3 font-medium text-white hover:bg-brand-700"
            >
              Create hotel account
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
