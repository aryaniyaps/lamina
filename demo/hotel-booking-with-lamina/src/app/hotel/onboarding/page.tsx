import Link from "next/link";
import { HotelShell } from "@/components/hotel-shell";
import { AMENITIES, CANCELLATION_TEMPLATES } from "@/lib/constants";
import {
  completeStripeConnectAction,
  savePropertyDraftAction,
  saveRoomTypeAction,
  setCancellationPolicyAction,
  submitPropertyForReviewAction,
} from "@/lib/actions/hotel";
import { requireHotelStaff, getHotelContext } from "@/lib/auth-guards";
import { parseJsonArray } from "@/lib/utils";
import { CancellationTemplate } from "@prisma/client";

const STEPS = ["stripe", "property", "rooms", "policy", "checklist", "submit"] as const;

export default async function HotelOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string; step?: string }>;
}) {
  const session = await requireHotelStaff();
  const ctx = await getHotelContext(session.id);
  const params = await searchParams;
  const step = (params.step as (typeof STEPS)[number]) || "stripe";
  const propertyId = params.propertyId ?? ctx?.hotelAccount.properties[0]?.id;

  const property = propertyId
    ? ctx?.hotelAccount.properties.find((p) => p.id === propertyId)
    : undefined;

  const stripeDone = ctx?.hotelAccount.stripeConnectComplete ?? false;
  const photos = property ? parseJsonArray(property.photos) : [];
  const hasRooms = (property?.roomTypes.length ?? 0) > 0;
  const hasPolicy = !!property?.cancellationPolicy;

  return (
    <HotelShell active="/hotel/onboarding">
      <h1 className="mb-2 text-2xl font-semibold text-brand-700">Property onboarding</h1>
      <p className="mb-8 text-sm text-stone-600">
        Complete each step to submit your property for review.
      </p>

      <nav className="mb-8 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <Link
            key={s}
            href={`/hotel/onboarding?step=${s}${propertyId ? `&propertyId=${propertyId}` : ""}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              step === s
                ? "bg-brand-600 text-white"
                : "bg-stone-200 text-stone-600 hover:bg-brand-50"
            }`}
          >
            {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </nav>

      <div className="max-w-2xl rounded-xl border border-stone-200 bg-white p-6">
        {step === "stripe" && (
          <div>
            <h2 className="mb-4 text-lg font-medium">Connect Stripe payouts</h2>
            {stripeDone ? (
              <p className="mb-4 text-sm text-brand-600">Stripe Connect is complete.</p>
            ) : (
              <>
                <p className="mb-4 text-sm text-stone-600">
                  Connect your bank account to receive payouts after guest check-in.
                </p>
                <form
                  action={async () => {
                    "use server";
                    await completeStripeConnectAction();
                  }}
                >
                  <button
                    type="submit"
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    Complete Stripe Connect (demo)
                  </button>
                </form>
              </>
            )}
            <NextLink step="property" propertyId={propertyId} />
          </div>
        )}

        {step === "property" && (
          <div>
            <h2 className="mb-4 text-lg font-medium">Property details</h2>
            <form
              action={async (fd) => {
                "use server";
                await savePropertyDraftAction(fd);
              }}
              className="space-y-4"
            >
              {propertyId && <input type="hidden" name="propertyId" value={propertyId} />}
              <input type="hidden" name="existingPhotos" value={property?.photos ?? "[]"} />
              <Field label="Property name" name="name" defaultValue={property?.name} required />
              <Field
                label="Description"
                name="description"
                defaultValue={property?.description}
                textarea
                required
              />
              <Field label="Address" name="addressLine1" defaultValue={property?.addressLine1} required />
              <div className="grid grid-cols-3 gap-3">
                <Field label="City" name="city" defaultValue={property?.city} required />
                <Field label="State" name="state" defaultValue={property?.state} required />
                <Field label="ZIP" name="zip" defaultValue={property?.zip} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Check-in time" name="checkInTime" defaultValue={property?.checkInTime ?? "15:00"} />
                <Field label="Check-out time" name="checkOutTime" defaultValue={property?.checkOutTime ?? "11:00"} />
              </div>
              <Field label="House rules" name="houseRules" defaultValue={property?.houseRules} textarea />
              <div>
                <span className="mb-2 block text-sm font-medium">Amenities</span>
                <div className="grid grid-cols-2 gap-2">
                  {AMENITIES.map((a) => (
                    <label key={a} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="amenities"
                        value={a}
                        defaultChecked={parseJsonArray(property?.amenities ?? "[]").includes(a)}
                      />
                      {a}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Photo URLs (one per line, min 5 for submit)</label>
                <textarea
                  name="photos"
                  rows={4}
                  defaultValue={photos.join("\n")}
                  placeholder="https://example.com/photo1.jpg"
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
              <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700">
                Save property
              </button>
            </form>
            <NextLink step="rooms" propertyId={propertyId} />
          </div>
        )}

        {step === "rooms" && (
          <div>
            <h2 className="mb-4 text-lg font-medium">Room types</h2>
            {!propertyId ? (
              <p className="text-sm text-stone-500">Save property details first.</p>
            ) : (
              <>
                {property?.roomTypes.map((r) => (
                  <div key={r.id} className="mb-4 rounded-lg border border-stone-200 p-4">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-sm text-stone-500">
                      {r.maxOccupancy} guests · ${(r.baseRateCents / 100).toFixed(0)}/night · {r.totalInventoryCount} rooms
                    </div>
                  </div>
                ))}
                <form
                  action={async (fd) => {
                    "use server";
                    await saveRoomTypeAction(fd);
                  }}
                  className="mt-4 space-y-4 border-t border-stone-200 pt-4"
                >
                  <input type="hidden" name="propertyId" value={propertyId} />
                  <Field label="Room name" name="name" required />
                  <Field label="Description" name="description" textarea required />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Max occupancy" name="maxOccupancy" type="number" defaultValue="2" required />
                    <Field label="Inventory count" name="totalInventoryCount" type="number" defaultValue="5" required />
                  </div>
                  <Field label="Bed configuration" name="bedConfiguration" defaultValue="1 King" required />
                  <Field label="Base rate ($/night)" name="baseRate" type="number" step="0.01" defaultValue="150" required />
                  <Field label="Photo URL" name="photo" />
                  <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700">
                    Add room type
                  </button>
                </form>
              </>
            )}
            <NextLink step="policy" propertyId={propertyId} />
          </div>
        )}

        {step === "policy" && (
          <div>
            <h2 className="mb-4 text-lg font-medium">Cancellation policy</h2>
            {!propertyId ? (
              <p className="text-sm text-stone-500">Save property details first.</p>
            ) : (
              <form
                action={async (fd) => {
                  "use server";
                  await setCancellationPolicyAction(fd);
                }}
                className="space-y-3"
              >
                <input type="hidden" name="propertyId" value={propertyId} />
                {(Object.keys(CANCELLATION_TEMPLATES) as CancellationTemplate[]).map((t) => (
                  <label
                    key={t}
                    className="flex cursor-pointer gap-3 rounded-lg border border-stone-200 p-4 hover:border-brand-500"
                  >
                    <input
                      type="radio"
                      name="template"
                      value={t}
                      defaultChecked={property?.cancellationPolicy?.template === t}
                      required
                    />
                    <div>
                      <div className="font-medium">{CANCELLATION_TEMPLATES[t].label}</div>
                      <div className="text-sm text-stone-500">{CANCELLATION_TEMPLATES[t].description}</div>
                    </div>
                  </label>
                ))}
                <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700">
                  Save policy
                </button>
              </form>
            )}
            <NextLink step="checklist" propertyId={propertyId} />
          </div>
        )}

        {step === "checklist" && (
          <div>
            <h2 className="mb-4 text-lg font-medium">Readiness checklist</h2>
            <ul className="space-y-2 text-sm">
              <CheckItem done={stripeDone} label="Stripe Connect complete" />
              <CheckItem done={!!property?.city && !!property?.state} label="US address on file" />
              <CheckItem done={photos.length >= 5} label={`At least 5 photos (${photos.length}/5)`} />
              <CheckItem done={hasRooms} label="At least one room type" />
              <CheckItem done={hasPolicy} label="Cancellation policy selected" />
            </ul>
            <NextLink step="submit" propertyId={propertyId} />
          </div>
        )}

        {step === "submit" && (
          <div>
            <h2 className="mb-4 text-lg font-medium">Submit for review</h2>
            {!propertyId ? (
              <p className="text-sm text-stone-500">Complete previous steps first.</p>
            ) : (
              <>
                <p className="mb-4 text-sm text-stone-600">
                  Our team will review your listing within 2 business days.
                </p>
                <form
                  action={async () => {
                    "use server";
                    await submitPropertyForReviewAction(propertyId);
                  }}
                >
                  <button
                    type="submit"
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    Submit for review
                  </button>
                </form>
              </>
            )}
          </div>
        )}
      </div>
    </HotelShell>
  );
}

function Field({
  label,
  name,
  defaultValue,
  required,
  textarea,
  type = "text",
  step,
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  required?: boolean;
  textarea?: boolean;
  type?: string;
  step?: string;
}) {
  const cls = "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none";
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {textarea ? (
        <textarea id={name} name={name} defaultValue={defaultValue} required={required} rows={3} className={cls} />
      ) : (
        <input
          id={name}
          name={name}
          type={type}
          step={step}
          defaultValue={defaultValue}
          required={required}
          className={cls}
        />
      )}
    </div>
  );
}

function CheckItem({ done, label }: { done: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-2 ${done ? "text-brand-600" : "text-stone-500"}`}>
      <span>{done ? "✓" : "○"}</span>
      {label}
    </li>
  );
}

function NextLink({ step, propertyId }: { step: string; propertyId?: string }) {
  const href = `/hotel/onboarding?step=${step}${propertyId ? `&propertyId=${propertyId}` : ""}`;
  return (
    <div className="mt-6 border-t border-stone-200 pt-4">
      <Link href={href} className="text-sm font-medium text-brand-600 hover:underline">
        Continue to {step} →
      </Link>
    </div>
  );
}
