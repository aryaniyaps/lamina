export const metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl font-bold">Terms of service</h1>
      <div className="mt-6 space-y-4 text-foreground/90">
        <p>By using HavenStay, you agree to these terms governing bookings between travelers and hotel partners.</p>
        <h2 className="font-display text-xl font-semibold">Bookings</h2>
        <p>Confirmed bookings constitute a binding agreement. Travelers must provide accurate guest information and comply with hotel policies.</p>
        <h2 className="font-display text-xl font-semibold">Payments</h2>
        <p>Payments are processed securely through Stripe. HavenStay charges a service fee disclosed at checkout.</p>
        <h2 className="font-display text-xl font-semibold">Partner obligations</h2>
        <p>Hotel partners must maintain accurate availability, honor confirmed reservations, and respond to guest communications promptly.</p>
        <h2 className="font-display text-xl font-semibold">Trust & safety</h2>
        <p>Users may report listings or reviews. HavenStay reserves the right to suspend properties that violate platform standards.</p>
      </div>
    </div>
  );
}
