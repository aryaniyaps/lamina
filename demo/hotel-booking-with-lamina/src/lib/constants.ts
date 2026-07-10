import { CancellationTemplate } from "@prisma/client";

export const HOLD_MINUTES = 15;
export const REVIEW_WINDOW_DAYS = 30;
export const TAX_RATE_ESTIMATE = 0.13;

export const CANCELLATION_TEMPLATES: Record<
  CancellationTemplate,
  { label: string; description: string }
> = {
  FLEXIBLE: {
    label: "Flexible",
    description:
      "Full refund until 24 hours before check-in. No refund after that.",
  },
  MODERATE: {
    label: "Moderate",
    description:
      "Full refund until 5 days before check-in. 50% refund until 24 hours before. No refund after that.",
  },
  STRICT: {
    label: "Strict",
    description:
      "50% refund until 7 days before check-in. No refund after that.",
  },
};

export const AMENITIES = [
  "Free WiFi",
  "Parking",
  "Pool",
  "Fitness center",
  "Pet friendly",
  "Breakfast included",
  "Air conditioning",
  "Restaurant",
  "Spa",
  "Room service",
  "Business center",
  "Airport shuttle",
];

export const DEMO_ACCOUNTS = {
  traveler: { email: "traveler@havenstay.demo", password: "demo1234" },
  hotel: { email: "hotel@havenstay.demo", password: "demo1234" },
  admin: { email: "admin@havenstay.demo", password: "demo1234" },
};
