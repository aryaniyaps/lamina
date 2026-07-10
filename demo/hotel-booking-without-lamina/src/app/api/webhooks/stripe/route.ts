import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { confirmBooking } from "@/lib/bookings";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 400 });
  }

  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const bookingId = session.metadata?.bookingId;

    if (bookingId) {
      const booking = await db.booking.findUnique({ where: { id: bookingId } });
      if (booking && booking.status === "PENDING_PAYMENT") {
        await confirmBooking(bookingId, {
          stripeSessionId: session.id,
          stripePaymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id,
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}
