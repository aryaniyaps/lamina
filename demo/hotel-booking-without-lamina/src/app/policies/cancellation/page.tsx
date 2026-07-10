import { DEFAULT_CANCELLATION_POLICY } from "@/lib/dates";

export const metadata = { title: "Cancellation policy" };

export default function CancellationPolicyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl font-bold">Cancellation policy</h1>
      <p className="mt-6 leading-relaxed text-foreground/90">{DEFAULT_CANCELLATION_POLICY}</p>
      <p className="mt-4 text-sm text-muted-foreground">
        Individual properties may have specific policies shown on their listing and at checkout.
      </p>
    </div>
  );
}
