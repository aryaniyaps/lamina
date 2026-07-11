# Household Budgeting App — Implementation Plan

## 1. Product Vision
A mobile-first household budgeting product for young US families that reduces financial anxiety through clarity. One active budget per household. Partners share a household view with clear privacy boundaries for personal categories. Offline viewing of balances is required; sync failures are recoverable and non-blaming.

## 2. Domain Model

### 2.1 Core Entities

| Entity | Key Attributes | Invariants |
|--------|----------------|------------|
| **User** | id, email, phone, name, createdAt, mfaEnabled | Email or phone verified before household creation. One Persona per user. |
| **Persona** | id, userId, displayName, avatarUrl, consentToDataUse | Controls in-app identity. Separate from auth provider account. |
| **Household** | id, name, createdAt, defaultCurrency (USD) | Exactly one `active` Budget at a time. One owner; may have one partner; may have viewers. |
| **HouseholdMembership** | householdId, userId, role (owner/partner/viewer), joinedAt, status (active/invited/removed) | Owner cannot be removed by partner. Viewer cannot invite, adjust budget, or link accounts. |
| **Budget** | id, householdId, startMonth, status (draft/active/archived) | Only one active budget per household. Draft can be deleted; active can be archived; archived is immutable. |
| **IncomeSource** | id, budgetId, name, amountCents, frequency, startDate, endDate | Annualized income computed from entries. Can be zero or empty. |
| **BudgetPeriod** | id, budgetId, month, state (planning/open/closed), rolloverCents | Auto-created for budget lifecycle. Open for current month, closed for past. |
| **Category** | id, budgetId, name, type (fixed/flexible/savings/personal), privacyLevel (shared/personal), allocationCents | Personal categories display only to owner even if partner is active. |
| **Account** | id, householdId, name, type (checking/savings/credit/loan/cash), mask, externalAccountId, institutionId, status (active/disconnected/error) | Household-scoped. Credit accounts tracked as liabilities; cash accounts are manual. |
| **Transaction** | id, accountId, externalTransactionId, amountCents, postedAt, description, merchantName, categoryId, status (posted/pending/excluded/duplicate) | Duplicate detection via fuzzy hash + amount + date + account. Excluded transactions don't count against budget. |
| **Alert** | id, householdId, userId, type (overBudget/transactionThreshold/accountSync/partnerAction), status (unread/dismissed/resolved), payload | Unread alerts surface in app and push. Dismissed stays actionable history. |
| **SyncJob** | id, accountId, startedAt, completedAt, status, errorCode, transactionsAdded, retries | Idempotent retry with exponential backoff. Errors exposed with recovery CTA. |
| **InviteToken** | id, householdId, invitedEmail, role, expiresAt, acceptedBy | Single-use; expires in 7 days. Can be revoked. |

### 2.2 Aggregate Boundaries
- **Household aggregate**: Household, Memberships, Accounts, Invites, Alerts.
- **Budget aggregate**: Budget, BudgetPeriods, Categories, IncomeSources.
- **Account aggregate**: Account, Transactions, SyncJobs.

### 2.3 Key Invariants (Illegal States Prevented)
1. A household has at most one `active` budget.
2. A user belongs to a household in only one role at a time.
3. A transaction belongs to exactly one account and one household (via account).
4. Personal category allocations are not visible to other members in UI or API.
5. Amounts stored as integer cents; never floating-point dollars.
6. Sync-only mutations (balances, transaction import) cannot overwrite user overrides (category, excluded status, duplicate resolution).
7. Push notifications never contain raw account numbers or full balances.

## 3. Actors and Permissions

### 3.1 Roles
| Capability | Owner | Partner | Viewer |
|-----------|-------|---------|--------|
| View shared household budget | Yes | Yes | Yes |
| View own personal categories | Yes | Yes | Yes |
| View partner's personal category totals | No | No | No |
| Create/edit categories | Yes | Yes* | No |
| Adjust allocations | Yes | Yes* | No |
| Link/remove financial accounts | Yes | Yes | No |
| Invite partner / viewers | Yes | No | No |
| Remove household members | Yes (except self) | No | No |
| Manage notification preferences | Own only | Own only | Own only |
| Resolve duplicates / edit transactions | Yes | Yes | No |
| Close/archive budget, start new budget | Yes | No | No |

\* Partner can create categories, but only Owner can toggle a category's privacy level.

### 3.2 Privacy Boundaries
- **Shared categories**: visible and editable by owner and partner.
- **Personal categories**: visible only to the member who created them. Partner sees only an aggregated "Personal" bucket with a label, never line items.
- **Transactions in personal categories**: same boundary applies.
- **Account-level dashboards**: aggregate household cashflow only; per-account details visible to all household members unless the account is explicitly marked private by owner. Credit card accounts default to shared if linked by owner; hidden details may be masked by name choice.

## 4. Primary Workflows

### 4.1 Onboarding
**Goal**: User creates identity, creates/joins household, defines first budget, optionally links accounts.

1. **Welcome screen**: value prop, no financial advice disclaimer.
2. **Auth / verify**: email or phone OTP; create Persona display name.
3. **Household creation**: name household, set timezone (defaults from device), default currency locked to USD.
4. **Budget setup**:
   - Input monthly net income sources (can skip → zero-income state).
   - Suggest budget categories: fixed (rent, utilities, subscriptions), flexible (groceries, dining, gas), savings (emergency, vacation), personal (discretionary). User can add/delete.
   - Allocate income across categories using 50/30/20-ish suggestions. Allow unallocated income ("leftover").
5. **Account linking offer** (skip allowed):
   - Initiate Plaid Link for checking/savings/credit.
   - On success, fetch last 90 days transactions and run duplicate detection.
6. **Invite partner** (defer allowed):
   - Shareable link or email invite with role `partner`.
7. **Onboarding complete**: animation, first weekly-review prompt, confirmation of notification preferences.

### 4.2 Account Linking
**Goal**: Connect financial accounts securely; import transactions; keep accounts in sync.

1. **Institution picker**: Plaid Link modal, US institutions only.
2. **Consent capture**: explicit screen recording what data is pulled (balances, transactions) and that it's read-only.
3. **Account selection**: user selects which accounts to import (can unselect loans/investment accounts — investment accounts are rejected by Plaid product config).
4. **Initial sync**:
   - Pull last 90 days.
   - Run transaction normalization (merchant name cleanup, pending vs posted).
   - Run duplicate detection against existing transactions.
   - Display imported count and any accounts with warnings.
5. **Ongoing sync**:
   - Nightly webhook/cron sync.
   - On app foreground, trigger refresh after 6 hours idle.
   - Store lastSuccessfulSyncAt per account; UI shows freshness.
6. **Unlinking**:
   - Option to delete account and all transactions, or keep historical data with manual status.

### 4.3 Weekly Review
**Goal**: User checks spending vs plan, resolves transactions, adjusts categories, celebrates progress.

1. **Open review cards** (one at a time):
   - **Spending snapshot**: left-to-spend per category for current week, with trend arrow vs last 4 weeks.
   - **Uncategorized transactions**: list to categorize or exclude; support bulk action.
   - **Duplicate candidates**: side-by-side comparison, accept merge/exclude/new.
   - **Category health**: over-budget categories highlighted; one-tap "Move $X from [Flexible category]" suggestion.
2. **Resolve actions**:
   - Categorize transaction → updates category spend.
   - Exclude transaction → no budget impact, optionally note reason.
   - Move money between categories → new entry in `BudgetAdjustment` audit log.
3. **Review completion**:
   - Summary: categories reviewed, transactions resolved, net available to spend.
   - CTA for next review date.
   - Generate in-app alert if any category > 80% spent.

### 4.4 Category Adjustment
**Goal**: Adapt budget allocations without blame.

1. From budget view or weekly review, tap category row.
2. Show current allocation, spent, remaining, and 3-month average.
3. User edits allocation; validation ensures total fixed/flexible/savings does not exceed total income unless user explicitly allows negative "leftover".
4. Save creates a `BudgetAdjustment` record with reason (optional), timestamp, actor.
5. Partner receives an activity alert: "[Name] updated Groceries allocation." No judgmental language.

### 4.5 Spending Alerts
**Goal**: Proactive, non-panicking notifications about budget conditions.

1. Alert types:
   - **Approaching limit**: category at 80% of allocation.
   - **Over budget**: category exceeds allocation.
   - **Large transaction**: single transaction above threshold (default $200).
   - **Account sync failure**: actionable CTA to reconnect.
   - **Low balance**: checking account below user-defined threshold.
   - **Partner joined / invite accepted**.
2. Delivery:
   - In-app notification center.
   - Push notification (respect quiet hours 22:00-08:00 local time).
   - Email digest weekly (summary only, no amounts if user opts out).
3. Tone: neutral, data-forward. "Groceries is at 85% of this month's plan." Not "You overspent."
4. Dismiss/resolve flows. Alerts can be grouped by type.

### 4.6 Partner Invite
**Goal**: Add a second adult to household with full shared visibility and preserved personal privacy.

1. Owner opens Household Settings → Invite Partner.
2. Choose method: email, SMS, or shareable link.
3. Partner receives invite with role `partner`; link opens app or web interstitial.
4. Partner creates account / verifies identity, then sees shared household budget. Owner is notified.
5. Partner can immediately:
   - View shared categories and transactions.
   - Add/edit their own personal categories.
   - Link own accounts (optional).
6. Owner remains the only member who can:
   - Archive budgets.
   - Remove members.
   - Toggle category privacy levels.
7. Invite expiry/voiding: 7-day expiry; owner can revoke pending invite; re-invite after expiry.

### 4.7 Household Settings
**Goal**: Control membership, accounts, notifications, and budget lifecycle.

1. **Household profile**: name, timezone, default currency (read-only USD).
2. **Members**: list roles, pending invites, remove (owner only), resend invite.
3. **Linked accounts**: list institutions, refresh, reconnect, unlink.
4. **Notification preferences** per user:
   - Push alert toggles per alert type.
   - Quiet hours.
   - Weekly digest email on/off.
   - Large-transaction threshold.
5. **Privacy**: toggles for account visibility defaults; personal categories always individually controlled.
6. **Budget history**: list archived budgets; view-only access; start new budget.
7. **Account security**: change password, enable MFA, export transaction data (CSV).
8. **Close household**: owner can delete household after confirmation; data retained for 30 days in soft-delete then purged.

## 5. Secondary Surfaces

### 5.1 Empty / Zero-Income States
- **No income defined**: show friendly empty state: "You haven't added income yet. Build your budget anyway, or add income later." Enable proceeding with zero allocation.
- **No transactions**: "Your transactions will appear here after you link an account or add them manually."
- **No linked accounts**: card persists on dashboard offering Plaid linking or manual entry.
- **Zero-income month**: budget view shows "$0 income budgeted"; percentages hidden; encourage adjustment or income entry.
- **All categories at zero**: show sample categories and one-tap starter templates.

### 5.2 Sync-Error Recovery UI
1. Detect error categories:
   - `INSTITUTION_LOGIN_REQUIRED` → CTA "Reconnect [Bank]" opens Plaid update mode.
   - `RATE_LIMITED` → show "Sync delayed; trying again in X minutes" with retry button disabled.
   - `INSTITUTION_NOT_SUPPORTED` → prompt to unlink or switch manual tracking.
   - `NETWORK_ERROR` → "You're offline. Last synced [time]. Balances available offline."
2. Avoid blame language; always provide a next action.
3. Background retry with exponential backoff up to 24 hours; user sees status progress.

### 5.3 Notification Preferences
1. Per-user screen inside Settings.
2. Toggles for: spending alerts, account sync issues, partner actions, weekly review reminder, large transactions, low balance.
3. Quiet hours honored globally; timezone-aware.
4. Push permission status banner if denied.

### 5.4 Category Privacy Controls
1. When creating/editing a category, owner selects **Shared** or **Personal**.
2. Personal categories grouped under a locked section for other members.
3. Partner sees only a single row: "Personal — [FirstName]" with total spent/allocated hidden by default unless the owner explicitly shares.
4. Audit log does not leak personal category names to other members.

## 6. Edge Cases and Recovery Paths

| Scenario | Handling |
|----------|----------|
| Duplicate transactions from re-link or aggregation overlap | Fuzzy matching on normalized amount + merchant + date ±2 days. UI presents candidate; user resolves once; decision persisted. |
| Partner leaves household | Household retains transactions tied to accounts; owner can reassign account ownership or mark manual. Budget stays active. |
| Owner transfers ownership | Required before owner can leave. One partner may be promoted. |
| Account disconnected during sync | Alert generated. User reconnects via Plaid update mode. Historical transactions retained; only new sync blocked. |
| Offline app open | Cache last known balances, budget, transactions. Display stale-data banner. Allow viewing and local draft edits; queue for sync. |
| Zero or negative income month | UI removes allocated-percentages and judgment. Encourage adjustment. Savings goals paused if net income ≤ 0. |
| Linked account has no transactions | Show empty state; offer set manual starting balance. |
| Large refund / return | Allow negative transaction amount or separate refund category. Default refund categorizes back to original spend category unless user overrides. |
| Split transactions | Support splitting a single transaction across multiple categories; store split children as separate transaction rows. |
| Foreign currency / crypto account | Rejected at linking step. UI explains US-only banks and USD only. |
| Invite accepted after expiry | Show "Invite expired" screen; owner can resend. |
| Two members edit budget concurrently | Optimistic locking (`version` on Budget); last-write-wins with conflict toast and reload. |
| User deletes app without closing account | Sessions expire; data retained per household membership until owner closes household. |
| Plaid institution outage | Graceful degradation: show stale data, suppress sync error for first 24h if known outage flag, offer manual balance update. |

## 7. Multi-Surface Product Map

### 7.1 Required Screens (mobile)
1. Welcome / Auth
2. Verify OTP
3. Create Persona & Household
4. Build Budget (income + categories)
5. Link Accounts (Plaid)
6. Invite Partner
7. Dashboard / Home
8. Weekly Review flow
9. Budget detail / category adjustment
10. Transactions list & filters
11. Transaction detail / categorize / split
12. Duplicates resolution
13. Alerts center
14. Household settings
15. Member management
16. Linked accounts management
17. Notification preferences
18. Category privacy controls
19. Profile & security
20. Empty/zero-income states (modal/overlays)
21. Sync error recovery screens
22. Archived budgets

### 7.2 Navigation Pattern
- Bottom nav: Home, Budget, Transactions, Alerts, Settings.
- Floating action button for quick actions: add transaction, start weekly review, adjust category.
- Deep-link support for invites, alerts, and reconnect flows.

### 7.3 Accessibility Requirements
- All interactive targets ≥ 44×44 dp.
- Screen-reader labels for every icon button and chart.
- Budget health not communicated by color alone; use text + iconography.
- Focus management preserved in modals; reduced-motion support.
- Minimum color contrast WCAG AA.
- Number formatting in US locale; avoid jargon.

## 8. Technical Architecture

### 8.1 Stack (recommended)
- **Frontend**: React Native (Expo) or Flutter, mobile-first.
- **Backend**: Node.js/TypeScript or Go; REST + WebSocket for real-time alerts.
- **Database**: PostgreSQL with row-level security where practical.
- **Auth**: Auth0 / Firebase Auth / custom; MFA optional.
- **Account aggregation**: Plaid (US-only product config, no investment/tax scopes).
- **Push notifications**: Firebase Cloud Messaging + APNS.
- **Offline sync**: SQLite on device with server reconciliation; CRDT or version vector for budget edits.
- **Background jobs**: Bull/Redis or SQS for nightly sync and retries.

### 8.2 API Surface (high-level domains)
- `POST /auth/*` — registration, OTP, tokens.
- `POST /households` — create household.
- `GET|PATCH /households/:id` — profile and membership.
- `POST /households/:id/invites` — invite & resend.
- `POST /invites/:token/accept` — accept invite.
- `GET|POST /budgets` — budget lifecycle.
- `GET|PATCH /budgets/:id/categories` — categories and privacy.
- `GET|POST /budgets/:id/adjustments` — audit log.
- `POST /accounts/link` — Plaid token exchange.
- `GET|DELETE /accounts/:id` — account management.
- `GET /transactions`, `PATCH /transactions/:id` — list, categorize, exclude, split.
- `POST /duplicates/:id/resolve` — merge/exclude/new.
- `GET /alerts`, `PATCH /alerts/:id` — list and dismiss.
- `GET|PATCH /preferences/notifications` — per-user prefs.

### 8.3 Sync Strategy
- Plaid webhooks fire to backend; enqueue `SyncJob`.
- Duplicate transaction detection runs inside job before insert.
- Conflict resolution rules:
  1. User overrides (category, excluded, split) always win over re-sync.
  2. Plaid pending→posted updates merge into existing row.
  3. Amount/description updates not matching duplicate hash create new pending duplicate candidate.
- Offline queue: simple FIFO for categorization and allocation edits; fail loudly on conflict.

## 9. Security and Compliance
- All financial data encrypted at rest (AES-256) and in transit (TLS 1.3).
- Plaid tokens never logged; access tokens stored in KMS-backed vault.
- No storage of full account numbers.
- No investment advice or tax guidance in any screen, push, email, or help content.
- COPPA/CCPA/GDPR-readiness: consent capture, data export, deletion flows.
- Role-based access control enforced in API layer, not just UI.
- Audit log for sensitive actions: invite accept, ownership transfer, account unlink, budget archive.

## 10. Success Metrics & Launch Criteria
| Metric | Target | Notes |
|--------|--------|-------|
| Weekly active users (% of installs) | 40% at D90 | Drives scope of retention-focused flows. |
| Onboarding completion | >60% | Reduce friction in income/account linking. |
| Weekly review started/completed | >30% of actives | Core habit loop. |
| Partner invite acceptance | >35% | Social loop validation. |
| Account sync success rate | >98% | Recovery UI must be effective. |
| Support tickets per user/month | <0.05 | Indicator of clarity and recovery. |

## 11. Named Trade-Offs

1. **One active budget per household** vs. multiple budgets. Chosen to enforce clarity and shared truth; couples cannot run competing budgets. Archived budgets provide history.
2. **50/30/20 starter template** vs. full custom. Starter template accelerates onboarding; full customization available.
3. **Plaid-only linking initially** vs. manual-only. Plaid speeds setup but creates sync-error surface; manual entry always available as fallback.
4. **Personal categories hidden by totals only** vs. completely hidden. Showing "Personal — Alex" total preserves household cashflow accuracy while respecting privacy.
5. **Optimistic UI with conflict reload** vs. real-time collaborative editing. Real-time budget editing is rare; optimistic UI keeps UX fast, with version conflicts surfaced simply.
6. **US-only / USD-only** vs. multi-currency. Scope reduces regulatory, formatting, and aggregation complexity for launch.

## 12. Implementation Phases

### Phase 1 — Foundation (weeks 1–3)
- Auth, User, Persona, Household, Membership domain and APIs.
- Local SQLite/RN storage for offline balances.
- Persona onboarding screens.

### Phase 2 — Budget Domain (weeks 4–6)
- Budget, BudgetPeriod, Category, IncomeSource CRUD.
- One-active-budget invariant enforcement.
- Zero-income and empty-category states.

### Phase 3 — Aggregation (weeks 7–9)
- Plaid integration: token exchange, account linking, transaction import.
- Sync job worker, duplicate detection.
- Sync error recovery UI.

### Phase 4 — Core Habits (weeks 10–12)
- Weekly review flow.
- Categorization, exclusion, split transactions, duplicate resolution.
- Spending alerts and notification preferences.

### Phase 5 — Sharing & Growth (weeks 13–14)
- Partner invite flow.
- Personal category privacy boundaries.
- Household settings, member management.

### Phase 6 — Polish & Launch Readiness (weeks 15–16)
- Accessibility audit, large touch targets, screen-reader labels.
- Security review, push notifications, email digest.
- Analytics, beta testing, store submission prep.

## 13. Deliverable Checklist
- [x] Domain entities and invariants defined.
- [x] Actors and permissions matrix.
- [x] Onboarding workflow end-to-end.
- [x] Account linking and sync workflow.
- [x] Weekly review workflow.
- [x] Category adjustment workflow.
- [x] Spending alerts workflow.
- [x] Partner invite workflow.
- [x] Household settings workflow.
- [x] Secondary surfaces: empty states, zero income, sync errors, notifications, privacy.
- [x] Edge cases and recovery paths enumerated.
- [x] Product surface mapped to screens and navigation.
- [x] Technical architecture and API domains.
- [x] Security, compliance, success metrics, trade-offs, implementation phases.
