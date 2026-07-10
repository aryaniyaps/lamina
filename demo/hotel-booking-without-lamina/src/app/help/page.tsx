import Link from "next/link";
import { db } from "@/lib/db";
import { createSupportTicketAction } from "@/actions/reviews";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Help center" };

const defaultArticles = [
  { slug: "booking", title: "How to book a stay", category: "Booking" },
  { slug: "cancellation", title: "Cancellation & refunds", category: "Booking" },
  { slug: "payments", title: "Payments & pricing", category: "Payments" },
  { slug: "partner", title: "Partner with HavenStay", category: "Partners" },
];

export default async function HelpPage() {
  const articles = await db.helpArticle.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
  }).catch(() => []);

  const displayArticles = articles.length > 0 ? articles : defaultArticles;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl font-bold">Help center</h1>
      <p className="mt-2 text-muted-foreground">Find answers or contact support</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {displayArticles.map((article) => (
          <Link
            key={article.slug}
            href={`/help/${article.slug}`}
            className="rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md"
          >
            <p className="text-xs font-medium uppercase text-teal-700">{article.category}</p>
            <p className="mt-1 font-semibold">{article.title}</p>
          </Link>
        ))}
      </div>

      <Card className="mt-12">
        <CardHeader title="Contact support" description="We typically respond within 24 hours" />
        <form action={createSupportTicketAction} className="space-y-4">
          <Input id="email" name="email" type="email" label="Email" required />
          <Input id="subject" name="subject" label="Subject" required />
          <div>
            <label htmlFor="message" className="block text-sm font-medium">Message</label>
            <textarea id="message" name="message" required rows={4} className="mt-1.5 w-full rounded-lg border border-border px-4 py-2.5 text-sm" />
          </div>
          <Button type="submit" variant="accent">Submit ticket</Button>
        </form>
      </Card>
    </div>
  );
}
