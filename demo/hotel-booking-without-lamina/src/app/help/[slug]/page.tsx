import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";

const staticContent: Record<string, { title: string; content: string }> = {
  booking: {
    title: "How to book a stay",
    content: `Search for your destination and dates on the homepage or search page. Browse available hotels, compare prices and reviews, then select a room. Sign in to complete your booking with guest details and payment. You'll receive a confirmation email and can manage your trip from the Trips page.`,
  },
  cancellation: {
    title: "Cancellation & refunds",
    content: `Cancellation policies vary by property but typically follow: free cancellation up to 48 hours before check-in (full refund), cancellations within 48 hours (50% refund), and no refund after check-in. Your specific policy is shown at booking and on your trip details. Refunds are processed to your original payment method.`,
  },
  payments: {
    title: "Payments & pricing",
    content: `All prices include a breakdown of nightly rates, taxes (12%), and a service fee. The total shown at checkout is the final amount charged. We accept major credit cards via Stripe. In development mode without Stripe configured, you can use simulate payment to test the flow.`,
  },
  partner: {
    title: "Partner with HavenStay",
    content: `Create a hotel partner account to list your property. Add room types, set availability and pricing on the calendar, then publish your hotel. Manage reservations, message guests, and respond to reviews from the partner portal.`,
  },
};

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const article = staticContent[slug] ?? (await db.helpArticle.findUnique({ where: { slug } }));
  return { title: article?.title ?? "Help" };
}

export default async function HelpArticlePage({ params }: Props) {
  const { slug } = await params;
  const dbArticle = await db.helpArticle.findUnique({ where: { slug } }).catch(() => null);
  const article = dbArticle ?? staticContent[slug];
  if (!article) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link href="/help" className="text-sm text-teal-800 hover:underline">← Back to help</Link>
      <h1 className="font-display mt-4 text-3xl font-bold">{article.title}</h1>
      <div className="prose prose-teal mt-6 whitespace-pre-line text-foreground/90">
        {article.content}
      </div>
    </div>
  );
}
