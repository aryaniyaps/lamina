import { AdminShell } from "@/components/admin-shell";
import { updateCommissionRateAction } from "@/lib/actions/admin";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-guards";

export default async function AdminSettingsPage() {
  await requireAdmin();

  const config = await db.platformConfig.findUnique({ where: { id: "default" } });
  const rate = config?.commissionRate ?? 0.15;

  return (
    <AdminShell active="/admin/settings">
      <h1 className="mb-6 text-2xl font-semibold text-brand-700">Platform settings</h1>

      <div className="max-w-md rounded-xl border border-stone-200 bg-white p-6">
        <h2 className="mb-4 font-medium">Commission rate</h2>
        <p className="mb-4 text-sm text-stone-600">
          Platform commission taken from each booking. Current rate: {(rate * 100).toFixed(1)}%
        </p>
        <form
          action={async (fd) => {
            "use server";
            const pct = Number(fd.get("rate"));
            await updateCommissionRateAction(pct / 100);
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="rate" className="mb-1 block text-sm font-medium">
              Commission rate (%)
            </label>
            <input
              id="rate"
              name="rate"
              type="number"
              step="0.1"
              min={0}
              max={50}
              defaultValue={(rate * 100).toFixed(1)}
              required
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
          >
            Save commission rate
          </button>
        </form>
      </div>
    </AdminShell>
  );
}
