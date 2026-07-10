import Link from "next/link";
import { notFound } from "next/navigation";
import { HotelShell } from "@/components/hotel-shell";
import { AMENITIES } from "@/lib/constants";
import { savePropertyDraftAction } from "@/lib/actions/hotel";
import { requireHotelStaff, getHotelContext } from "@/lib/auth-guards";
import { parseJsonArray } from "@/lib/utils";

export default async function PropertyEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireHotelStaff();
  const ctx = await getHotelContext(session.id);
  const { id } = await params;

  const property = ctx?.hotelAccount.properties.find((p) => p.id === id);
  if (!property) notFound();

  const photos = parseJsonArray(property.photos);
  const amenities = parseJsonArray(property.amenities);

  return (
    <HotelShell active="/hotel">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-700">{property.name}</h1>
          <p className="text-sm text-stone-500">Status: {property.status.replace(/_/g, " ")}</p>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/hotel/property/${id}/calendar`}
            className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50"
          >
            Inventory calendar
          </Link>
        </div>
      </div>

      {property.changeRequest && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>Changes requested:</strong> {property.changeRequest}
        </div>
      )}

      {property.rejectionReason && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Rejection reason:</strong> {property.rejectionReason}
        </div>
      )}

      <form
        action={async (fd) => {
          "use server";
          await savePropertyDraftAction(fd);
        }}
        className="max-w-2xl space-y-4 rounded-xl border border-stone-200 bg-white p-6"
      >
        <input type="hidden" name="propertyId" value={property.id} />
        <input type="hidden" name="existingPhotos" value={property.photos} />

        <Field label="Property name" name="name" defaultValue={property.name} required />
        <Field label="Description" name="description" defaultValue={property.description} textarea required />
        <Field label="Address" name="addressLine1" defaultValue={property.addressLine1} required />
        <div className="grid grid-cols-3 gap-3">
          <Field label="City" name="city" defaultValue={property.city} required />
          <Field label="State" name="state" defaultValue={property.state} required />
          <Field label="ZIP" name="zip" defaultValue={property.zip} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check-in" name="checkInTime" defaultValue={property.checkInTime} />
          <Field label="Check-out" name="checkOutTime" defaultValue={property.checkOutTime} />
        </div>
        <Field label="House rules" name="houseRules" defaultValue={property.houseRules} textarea />

        <div>
          <span className="mb-2 block text-sm font-medium">Amenities</span>
          <div className="grid grid-cols-2 gap-2">
            {AMENITIES.map((a) => (
              <label key={a} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="amenities" value={a} defaultChecked={amenities.includes(a)} />
                {a}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Photo URLs</label>
          <textarea
            name="photos"
            rows={4}
            defaultValue={photos.join("\n")}
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </div>

        <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700">
          Save changes
        </button>
      </form>

      {property.roomTypes.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-medium">Room types</h2>
          <div className="space-y-2">
            {property.roomTypes.map((r) => (
              <div key={r.id} className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
                <div className="font-medium">{r.name}</div>
                <div className="text-stone-500">
                  {r.bedConfiguration} · {r.maxOccupancy} guests · ${(r.baseRateCents / 100).toFixed(0)}/night ·{" "}
                  {r.totalInventoryCount} rooms
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </HotelShell>
  );
}

function Field({
  label,
  name,
  defaultValue,
  required,
  textarea,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  textarea?: boolean;
}) {
  const cls = "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm";
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {textarea ? (
        <textarea id={name} name={name} defaultValue={defaultValue} required={required} rows={3} className={cls} />
      ) : (
        <input id={name} name={name} defaultValue={defaultValue} required={required} className={cls} />
      )}
    </div>
  );
}
