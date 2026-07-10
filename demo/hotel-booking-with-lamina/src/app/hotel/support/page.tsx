import { format } from "date-fns";
import { TicketCategory } from "@prisma/client";
import { HotelShell } from "@/components/hotel-shell";
import { createSupportTicketAction } from "@/lib/actions/hotel";
import { db } from "@/lib/db";
import { requireHotelStaff, getHotelContext } from "@/lib/auth-guards";
import { parseJsonArray } from "@/lib/utils";

const CATEGORIES: TicketCategory[] = ["BOOKING", "PAYMENT", "ACCOUNT", "LISTING", "TRUST"];

export default async function HotelSupportPage() {
  const session = await requireHotelStaff();
  const ctx = await getHotelContext(session.id);

  const tickets = await db.supportTicket.findMany({
    where: {
      OR: [{ userId: session.id }, { hotelAccountId: ctx?.hotelAccountId }],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <HotelShell active="/hotel/support">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Support</h1>

      <div className="mb-8 max-w-xl rounded-xl border border-stone-200 bg-white p-6">
        <h2 className="mb-4 font-medium">Open a ticket</h2>
        <form
          action={async (fd) => {
            "use server";
            await createSupportTicketAction(fd);
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="category" className="mb-1 block text-sm font-medium">
              Category
            </label>
            <select
              id="category"
              name="category"
              required
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="subject" className="mb-1 block text-sm font-medium">
              Subject
            </label>
            <input
              id="subject"
              name="subject"
              required
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="message" className="mb-1 block text-sm font-medium">
              Message
            </label>
            <textarea
              id="message"
              name="message"
              rows={4}
              required
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
          >
            Submit ticket
          </button>
        </form>
      </div>

      <h2 className="mb-3 font-medium">Your tickets</h2>
      {tickets.length === 0 ? (
        <p className="text-sm text-stone-500">No support tickets yet.</p>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => {
            const messages = parseJsonArray<{ from: string; body: string; at: string }>(t.messages);
            return (
              <div key={t.id} className="rounded-lg border border-stone-200 bg-white p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium">{t.subject}</div>
                    <div className="text-xs text-stone-500">
                      {t.category} · {format(t.createdAt, "MMM d, yyyy")}
                    </div>
                  </div>
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-600">
                    {t.status}
                  </span>
                </div>
                {messages[0] && (
                  <p className="mt-2 text-sm text-stone-600">{messages[0].body}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </HotelShell>
  );
}
