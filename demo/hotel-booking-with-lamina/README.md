# HavenStay

A production-ready US hotel booking marketplace for independent and boutique hotels.

Built from the Lamina design contract at `.lamina/runs/havenstay-platform-2026-07-10/`.

## Stack

- **Next.js 15** (App Router, Server Actions)
- **Prisma** + SQLite (swap to PostgreSQL for production)
- **Stripe** (optional — mock payments work without keys)
- **Tailwind CSS 4**

## Surfaces

| Surface | URL | Users |
|---------|-----|-------|
| Traveler web | `/` | Search, book, manage trips, reviews |
| Hotel dashboard | `/hotel` | Self-serve onboarding, inventory, reservations |
| Platform admin | `/admin` | Full ops console — approvals, trust, payments, audit |

## Quick start

```bash
npm install
npm run db:setup   # create DB + seed demo data
npm run dev        # http://localhost:3000
```

## Demo accounts

Password for all: `demo1234`

| Email | Role |
|-------|------|
| `traveler@havenstay.demo` | Traveler |
| `hotel@havenstay.demo` | Hotel operator |
| `admin@havenstay.demo` | Platform admin |

## Environment

Copy `.env.example` to `.env`. Key variables:

- `DATABASE_URL` — SQLite path or PostgreSQL connection string
- `SESSION_SECRET` — JWT session signing key
- `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — optional; without these, payments run in mock mode

## Key flows

1. **Search & book** — Home → Search → Hotel detail → Checkout → Confirmation
2. **Hotel onboarding** — List your property → Self-serve wizard → Admin approval → Live
3. **Admin ops** — Approvals queue, user/hotel management, booking overrides, trust reports

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run db:setup` | Push schema + seed |
| `npm run db:seed` | Re-seed demo data |

## Verify

After deployment, run `/lamina-verify` against the live product.
