import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { BookingStatus } from "@prisma/client";
import { AdminShell } from "@/components/admin-shell";
import { adminCancelBookingAction } from "@/lib/actions/admin";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guards";
import { formatCents } from "@/lib/utils";

export default async function AdminBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const booking = await db.booking.findUnique({
    where: { id },
    include: {
      property: true,
      user: true,
      lines: { include: { roomType: true } },
      payment: true,
      refunds: true,
    },
  });

  if (!booking) notFound();

  const canCancel =
    booking.status !== BookingStatus.CANCELLED_BY_TRAVELER &&
    booking.status !== BookingStatus.CANCELLED_BY_HOTEL;

  return (
    <AdminShell active="/admin/bookings">
      <Link href="/admin/bookings" className="text-sm text-brand-600 hover:underline">
        ← All bookings
      </Link>

      <div className="mt-4 mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-700">{booking.confirmationCode}</h1>
          <p className="text-sm text-stone-500">{booking.property.name}</p>
        </div>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-600">
          {booking.status.replace(/_/g, " ")}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="mb-4 font-medium">Guest</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Name" value={booking.guestName ?? booking.user.name} />
            <Row label="Email" value={booking.guestEmail ?? booking.user.email} />
            <Row label="Guests" value={String(booking.guestCount)} />
          </dl>
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="mb-4 font-medium">Stay & payment</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Check-in" value={format(booking.checkInDate, "MMM d, yyyy")} />
            <Row label="Check-out" value={format(booking.checkOutDate, "MMM d, yyyy")} />
            <Row label="Room total" value={formatCents(booking.roomTotalCents)} />
            <Row label="Taxes & fees" value={formatCents(booking.taxesFeesCents)} />
            <Row label="Total" value={formatCents(booking.totalCents)} />
            <Row label="Commission" value={formatCents(booking.commissionCents)} />
            {booking.payment && (
              <Row label="Payment" value={booking.payment.status.replace(/_/g, " ")} />
            )}
          </dl>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-stone-200 bg-white p-6">
        <h2 className="mb-4 font-medium">Room lines</h2>
        <ul className="space-y-2 text-sm">
          {booking.lines.map((l) => (
            <li key={l.id}>
              {l.quantity}× {l.roomType.name} — {l.nights} nights @ {formatCents(l.ratePerNightCents)}/night
            </li>
          ))}
        </ul>
      </section>

      {booking.refunds.length > 0 && (
        <section className="mt-6 rounded-xl border border-stone-200 bg-white p-6">
          <h2 className="mb-4 font-medium">Refunds</h2>
          <ul className="space-y-2 text-sm">
            {booking.refunds.map((r) => (
              <li key={r.id}>
                {formatCents(r.amountCents)} — {r.reason} ({r.status})
              </li>
            ))}
          </ul>
        </section>
      )}

      {canCancel && booking.payment && (
        <section className="mt-6 rounded-xl border border-red-200 bg-red-50/50 p-6">
          <h2 className="mb-4 font-medium text-red-800">Admin cancel override</h2>
          <form
            action={async (fd) => {
              "use server";
              await adminCancelBookingAction(
                booking.id,
                String(fd.get("reason")),
                Math.round(Number(fd.get("refundAmount")) * 100),
              );
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="reason" className="mb-1 block text-sm font-medium">
                Reason
              </label>
              <input
                id="reason"
                name="reason"
                required
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="refundAmount" className="mb-1 block text-sm font-medium">
                Refund amount ($)
              </label>
              <input
                id="refundAmount"
                name="refundAmount"
                type="number"
                step="0.01"
                min={0}
                max={booking.totalCents / 100}
                defaultValue={(booking.totalCents / 100).toFixed(2)}
                required
                className="w-full max-w-xs rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
            >
              Cancel booking & issue refund
            </button>
          </form>
        </section>
      )}
    </AdminShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-stone-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
