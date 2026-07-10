import Link from "next/link";
import { TravelerHeader } from "@/components/traveler-header";
import { SupportTicketForm } from "./support-form";

const faqs = [
  {
    q: "How do I modify my reservation?",
    a: "Contact the property directly using the address on your reservation, or submit a support ticket and we'll assist you.",
  },
  {
    q: "What is your cancellation policy?",
    a: "Each property sets one of three HavenStay templates (Flexible, Moderate, or Strict). Your specific policy is shown at checkout and on your reservation.",
  },
  {
    q: "When will I receive my refund?",
    a: "Refunds are processed to your original payment method within 5–10 business days after cancellation is confirmed.",
  },
  {
    q: "How do I leave a review?",
    a: "After checkout, visit My Trips and select your completed stay. Reviews can be submitted within 30 days of checkout.",
  },
];

export default function HelpPage() {
  return (
    <>
      <TravelerHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">Help center</h1>
        <p className="mt-1 text-stone-500">Find answers or contact our support team</p>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Frequently asked questions</h2>
          <div className="mt-4 space-y-4">
            {faqs.map((faq) => (
              <details
                key={faq.q}
                className="group rounded-2xl border border-stone-200 bg-white p-5"
              >
                <summary className="cursor-pointer font-medium group-open:text-brand-600">
                  {faq.q}
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-stone-600">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mt-12 grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-lg font-semibold">Contact support</h2>
            <p className="mt-1 text-sm text-stone-500">
              Can&apos;t find what you need? Submit a ticket and we&apos;ll get back to you.
            </p>
            <div className="mt-6 rounded-2xl border border-stone-200 bg-white p-6">
              <SupportTicketForm />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold">Quick links</h2>
            <ul className="mt-4 space-y-3">
              <li>
                <Link href="/trips" className="text-brand-600 hover:text-brand-700">
                  My trips →
                </Link>
              </li>
              <li>
                <Link href="/account" className="text-brand-600 hover:text-brand-700">
                  Account settings →
                </Link>
              </li>
              <li>
                <Link href="/search" className="text-brand-600 hover:text-brand-700">
                  Search properties →
                </Link>
              </li>
            </ul>

            <div className="mt-8 rounded-2xl bg-brand-50 p-6">
              <h3 className="font-semibold text-brand-700">Hotel partners</h3>
              <p className="mt-2 text-sm text-stone-600">
                Need help with your listing? Visit the hotel dashboard or contact listing support.
              </p>
              <Link
                href="/hotel"
                className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                Hotel dashboard →
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
