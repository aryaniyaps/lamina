import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeClient) stripeClient = new Stripe(key);
  return stripeClient;
}

export function isStripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export async function createPaymentIntent(amountCents: number, metadata: Record<string, string>) {
  const stripe = getStripe();
  if (!stripe) {
    return { id: `mock_pi_${Date.now()}`, clientSecret: `mock_secret_${Date.now()}` };
  }

  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    metadata,
    automatic_payment_methods: { enabled: true },
  });

  return { id: intent.id, clientSecret: intent.client_secret! };
}

export async function confirmMockPayment(paymentIntentId: string): Promise<boolean> {
  if (paymentIntentId.startsWith("mock_pi_")) return true;
  const stripe = getStripe();
  if (!stripe) return true;
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return intent.status === "succeeded";
}

export async function createRefund(paymentIntentId: string, amountCents: number) {
  const stripe = getStripe();
  if (!stripe || paymentIntentId.startsWith("mock_pi_")) {
    return { id: `mock_re_${Date.now()}` };
  }
  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount: amountCents,
  });
  return { id: refund.id };
}
