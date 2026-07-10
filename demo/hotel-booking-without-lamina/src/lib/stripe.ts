import Stripe from "stripe";

export const stripeEnabled = Boolean(process.env.STRIPE_SECRET_KEY);

export const stripe = stripeEnabled
  ? new Stripe(process.env.STRIPE_SECRET_KEY!)
  : null;

export async function createCheckoutSession({
  bookingId,
  amount,
  currency,
  customerEmail,
  hotelName,
  successUrl,
  cancelUrl,
}: {
  bookingId: string;
  amount: number;
  currency: string;
  customerEmail: string;
  hotelName: string;
  successUrl: string;
  cancelUrl: string;
}) {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  return stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: customerEmail,
    line_items: [
      {
        price_data: {
          currency,
          unit_amount: amount,
          product_data: {
            name: `Stay at ${hotelName}`,
            description: `Booking ${bookingId}`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: { bookingId },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

export async function createRefund(
  paymentIntentId: string,
  amount?: number
) {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  return stripe.refunds.create({
    payment_intent: paymentIntentId,
    ...(amount !== undefined ? { amount } : {}),
  });
}
