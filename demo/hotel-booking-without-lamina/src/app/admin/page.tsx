import { requireAdmin } from "@/lib/session";
import { db } from "@/lib/db";
import { formatCurrency } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  await requireAdmin();

  const [hotels, users, bookings, reports] = await Promise.all([
    db.hotel.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    db.user.count(),
    db.booking.count({ where: { status: "CONFIRMED" } }),
    db.report.findMany({ where: { status: "OPEN" }, include: { reporter: true, hotel: true }, take: 10 }),
  ]);

  const revenue = await db.booking.aggregate({
    where: { status: { in: ["CONFIRMED", "COMPLETED"] } },
    _sum: { totalAmount: true },
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl font-bold">Platform admin</h1>

      <div className="mt-8 grid gap-4 sm:grid-cols-4">
        <Card><p className="text-sm text-muted-foreground">Users</p><p className="text-2xl font-bold">{users}</p></Card>
        <Card><p className="text-sm text-muted-foreground">Hotels</p><p className="text-2xl font-bold">{hotels.length}</p></Card>
        <Card><p className="text-sm text-muted-foreground">Confirmed bookings</p><p className="text-2xl font-bold">{bookings}</p></Card>
        <Card><p className="text-sm text-muted-foreground">Revenue</p><p className="text-2xl font-bold">{formatCurrency(revenue._sum.totalAmount ?? 0)}</p></Card>
      </div>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">Open reports</h2>
        <div className="mt-4 space-y-2">
          {reports.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">{r.reason}</p>
                <Badge variant="warning">{r.status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">By {r.reporter.name} · {r.hotel?.name ?? "Review"}</p>
              {r.description && <p className="mt-2 text-sm">{r.description}</p>}
            </div>
          ))}
          {reports.length === 0 && <p className="text-muted-foreground">No open reports</p>}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">Hotels</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2">Name</th>
                <th className="pb-2">City</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {hotels.map((h) => (
                <tr key={h.id} className="border-b">
                  <td className="py-2"><Link href={`/hotels/${h.slug}`} className="hover:underline">{h.name}</Link></td>
                  <td className="py-2">{h.city}</td>
                  <td className="py-2"><Badge>{h.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
