# HavenStay

A production-shaped dual-sided hotel booking platform. Travelers discover, compare, and book stays. Hotel partners manage properties, rooms, pricing, availability, reservations, and guest interactions.

## Stack

- **Next.js 16** (App Router) + TypeScript + Tailwind CSS
- **Prisma** + PostgreSQL
- **Auth.js** (credentials + optional Google OAuth)
- **Stripe** Checkout + webhooks (with dev simulate mode)
- **Resend** for email (console fallback when unset)

## Quick start

### 1. Start PostgreSQL

```bash
docker compose up -d
```

### 2. Environment

```bash
cp .env.example .env
```

Edit `.env` if needed. Defaults work for local development.

### 3. Install & database

```bash
npm install
npm run db:setup
```



### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Demo accounts

All accounts use password: `password123`


| Role        | Email                 |
| ----------- | --------------------- |
| Traveler    | `guest@havenstay.com` |
| Hotel owner | `owner@havenstay.com` |
| Admin       | `admin@havenstay.com` |




## Demo flow

1. **Search & book** — Search "Bali" on the homepage → pick a hotel → select room → sign in → complete booking → use "Simulate payment" if Stripe is not configured
2. **Manage trip** — View `/trips` → open booking → cancel, message hotel, or leave review after checkout
3. **Partner portal** — Sign in as `owner@havenstay.com` → `/partner` → manage property, rooms, calendar, reservations



## Environment variables


| Variable                | Required | Description                               |
| ----------------------- | -------- | ----------------------------------------- |
| `DATABASE_URL`          | Yes      | PostgreSQL connection string              |
| `AUTH_SECRET`           | Yes      | Auth.js secret                            |
| `AUTH_URL`              | Yes      | App URL for auth callbacks                |
| `STRIPE_SECRET_KEY`     | No       | Enables real Stripe payments              |
| `STRIPE_WEBHOOK_SECRET` | No       | Stripe webhook verification               |
| `RESEND_API_KEY`        | No       | Email delivery (logs to console if unset) |
| `AUTH_GOOGLE_ID/SECRET` | No       | Google OAuth                              |




## Scripts


| Command            | Description             |
| ------------------ | ----------------------- |
| `npm run dev`      | Development server      |
| `npm run build`    | Production build        |
| `npm run db:setup` | Push schema + seed data |
| `npm run db:seed`  | Re-seed database        |




## Project structure

```
src/
  app/           # Routes (marketing, guest, partner, admin, auth)
  actions/       # Server actions
  components/    # UI components
  lib/           # Database, auth, bookings, search, etc.
prisma/
  schema.prisma  # Data model
  seed.ts        # Demo data (10 hotels, rooms, inventory)
```



## Features

**Travelers:** search/filter, hotel detail, booking + payment, trips, cancellations, reviews, messaging, notifications, help center

**Partners:** property CRUD, room management, calendar pricing/availability, reservations, guest messaging, review responses, analytics dashboard

**Platform:** role-based access, trust reports, admin overview, accessibility-minded UI

## License

Private — all rights reserved.