# Implementation Blueprint for Household Budgeting App

## Overview
This document provides a concrete, stack‑agnostic implementation plan that can be followed by developers to build a **mobile‑first, multi‑surface household budgeting product** as described in `run.yaml`. It covers architecture, data storage, sync strategy, UI components, accessibility, testing, and deployment considerations.

## 1. Architecture
- **Client**: React Native (or Flutter) for iOS/Android, compiled as a PWA for web.
- **Backend**: Serverless functions (Node.js/TypeScript) exposing a **REST** API (optionally GraphQL) behind an API gateway.
- **Database**: PostgreSQL (hosted on a managed service) with UUID primary keys.
- **Sync Layer**: Background jobs (e.g., AWS Lambda + SQS) that pull account data from external providers via OAuth and push notifications via SNS/FCM.
- **Cache / Offline**: SQLite on device (React Native SQLite) for offline storage; sync queue persisted locally.
- **Auth**: OAuth2 / OpenID Connect (e.g., Auth0) for email/password and social login.
- **Push Notifications**: Firebase Cloud Messaging (iOS/Android) and Web Push for the PWA.

## 2. Data Model Mapping (SQL DDL)
```sql
CREATE TABLE households (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  primary_budgeter_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  household_id UUID REFERENCES households(id),
  role TEXT CHECK (role IN ('primary_budgeter','partner','occasional_viewer')) NOT NULL,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE budgets (
  id UUID PRIMARY KEY,
  household_id UUID REFERENCES households(id) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_income NUMERIC(12,2) DEFAULT 0,
  total_expense NUMERIC(12,2) DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT one_active_budget_per_household UNIQUE (household_id) WHERE active
);

CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  household_id UUID REFERENCES households(id) NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  balance NUMERIC(12,2) DEFAULT 0,
  last_sync TIMESTAMP WITH TIME ZONE,
  UNIQUE (household_id, external_id)
);

CREATE TABLE categories (
  id UUID PRIMARY KEY,
  household_id UUID REFERENCES households(id) NOT NULL,
  name TEXT NOT NULL,
  is_shared BOOLEAN NOT NULL DEFAULT true,
  budgeted_amount NUMERIC(12,2) DEFAULT 0
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY,
  account_id UUID REFERENCES accounts(id) NOT NULL,
  category_id UUID REFERENCES categories(id),
  amount NUMERIC(12,2) NOT NULL,
  date DATE NOT NULL,
  description TEXT,
  is_personal BOOLEAN NOT NULL DEFAULT false,
  sync_status TEXT CHECK (sync_status IN ('pending','synced','duplicate')) NOT NULL DEFAULT 'pending'
);

CREATE TABLE alerts (
  id UUID PRIMARY KEY,
  household_id UUID REFERENCES households(id) NOT NULL,
  type TEXT CHECK (type IN ('budget_overrun','category_overrun','sync_failure')) NOT NULL,
  threshold NUMERIC(12,2) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  channel TEXT CHECK (channel IN ('email','push','sms')) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true
);
```

## 3. API Endpoints (high‑level)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/households` | Create household + primary_budgeter user |
| GET | `/households/:id` | Fetch household details (incl. active budget) |
| POST | `/households/:id/invite` | Generate partner invite token |
| POST | `/accounts` | Add linked account (OAuth flow) |
| GET | `/accounts/:id/sync` | Trigger sync job |
| GET | `/budgets/:id/weekly-review` | Aggregated weekly spend data |
| PATCH | `/categories/:id` | Update budgeted amount, privacy flag |
| POST | `/alerts` | Create/enable alert |
| PATCH | `/alerts/:id` | Update threshold/enable flag |
| POST | `/notifications/preferences` | Set channel preferences |
| GET | `/transactions?filter=...` | List with pagination, filters for personal/shared |
| POST | `/transactions` | Add manual transaction (offline‑first) |

All endpoints return standard JSON with proper HTTP status codes. Authentication via Bearer token.

## 4. Sync & Offline Strategy
1. **Initial Link** – OAuth flow returns provider token; backend stores encrypted token and enqueues a sync job.
2. **Sync Job** – Pulls recent transactions, normalizes, dedupes (hash of amount+date+description). Marks duplicates with `sync_status='duplicate'`.
3. **Offline Queue** – Client stores new transactions locally with `sync_status='pending'`. When connectivity restores, a background worker batches them to `/transactions` endpoint.
4. **Conflict Resolution** – Server checks for duplicates on ingest; if conflict, returns merged ID.
5. **Battery‑friendly** – Background sync runs only when app is foregrounded or when user toggles "background sync" in settings.

## 5. UI Component Map (React Native)
- **OnboardingFlow** – screens: Welcome → Create Household → Add Budget → Invite Partner (optional) → Set Notification Prefs.
- **AccountLinkScreen** – provider picker, OAuth webview, loading state, error handling.
- **WeeklyReviewScreen** – summary cards (Income, Expense, Net), bar chart per category, swipe to adjust budget.
- **CategoryList** – toggle shared/private, edit budgeted amount inline.
- **AlertSettings** – list of alerts with sliders/inputs for thresholds.
- **PartnerInvite** – QR code / deep link generation, copy link button.
- **SettingsScreen** – notification channel toggles, sync frequency, cache size, logout.
- **ErrorModals** – sync failure, duplicate transaction conflict, privacy leak warning.

All components must use **React Native Accessibility** props (`accessibilityLabel`, `accessibilityRole`, `importantForAccessibility`) and ensure color contrast > 4.5:1.

## 6. Accessibility Checklist
- All interactive elements have a minimum 48 dp touch target.
- Screen‑reader labels convey purpose and state (e.g., "Budget Overrun Alert, enabled").
- Use `aria-live` regions for sync status updates.
- Provide text alternatives for icons.
- Do not rely solely on color to indicate error or success; include icons/text.
- Support dynamic type (font scaling) and high‑contrast mode.

## 7. Testing Strategy
- **Unit Tests** – Jest for business logic (budget calculations, duplicate detection).
- **Integration Tests** – Supertest against API routes, including auth flows.
- **E2E Mobile Tests** – Detox (React Native) covering onboarding, account linking, weekly review adjustments, partner invite flow.
- **Accessibility Tests** – axe-core integration in CI, manual screen‑reader verification.
- **Performance Tests** – Simulate offline usage with large transaction sets (10k rows) to ensure UI remains responsive.

## 8. CI/CD Pipeline (GitHub Actions example)
```yaml
name: CI
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install deps
        run: npm ci
      - name: Lint
        run: npm run lint
  test:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm test
  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run build
  deploy:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to staging
        run: ./scripts/deploy.sh staging
```
Include a separate workflow for **mobile app builds** (Fastlane) and **security scans** (npm audit, Snyk).

## 9. Security & Privacy
- Encrypt stored OAuth tokens at rest (KMS).
- Enforce least‑privilege IAM roles for sync jobs.
- Validate all client‑side inputs server‑side (amount range, date format).
- Log privacy‑boundary violations (personal transaction shown to partner) with audit trail, but do not expose details to the partner.
- Regularly rotate API keys and JWT secret.
- Conduct a **threat model** focusing on data leakage, account takeover, and sync‑job abuse.

## 10. Release Milestones
| Milestone | Scope |
|-----------|-------|
| M1 – Core Backend | DB schema, auth, household & budget CRUD, basic sync job mock.
| M2 – Mobile MVP | Onboarding, account linking UI, weekly review, alerts UI (no partner invite).
| M3 – Partner Collaboration | Invite flow, shared categories, privacy enforcement.
| M4 – Offline & Sync Resilience | Full offline queue, duplicate detection, error UI.
| M5 – Accessibility & Edge Cases | Accessibility audit, zero‑income handling, empty account UI.
| M6 – Production Ready | CI/CD, monitoring push notifications, performance tuning.

## 11. Future Extensibility
- **GraphQL API** for flexible client queries.
- **Third‑party integrations** (e.g., Plaid, Yodlee) via plugin architecture.
- **Export/Import** of budget data (CSV, JSON).
- **AI‑driven insights** (spending recommendations) as a separate service.

---
*This blueprint is deliberately technology‑agnostic where possible, enabling the team to choose their preferred stack while satisfying the contract in `run.yaml`. Follow the steps sequentially, validate each milestone, and iterate based on user testing and accessibility reviews.*