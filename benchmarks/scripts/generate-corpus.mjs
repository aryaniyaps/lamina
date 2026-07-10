#!/usr/bin/env node
/**
 * Generate LaminaBench v2.0 task corpus (25 tasks + goldens).
 * Run once to materialize tasks/ and goldens/ directories.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASKS = path.join(ROOT, 'benchmarks/tasks');
const GOLDENS = path.join(ROOT, 'benchmarks/goldens');

const V2_SECTIONS = [
  'domain model and illegal states',
  'actors and permissions',
  'workflows and decision points',
  'edge cases and recovery',
  'implementation brief',
];

const AUDIT_SECTIONS = ['executive summary', 'findings', 'prioritized improvements'];

const CORPUS = [
  // Greenfield (5)
  {
    id: 'task001',
    category: 'greenfield',
    workflow: 'design',
    fixture: null,
    human_eval: true,
    prompt: 'Design the product behavior for a household budgeting app: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Household Budgeting App

Build a **minimal vertical slice** of a mobile-first household budgeting product for young US families: link accounts, set one household budget, run a weekly review, and surface spending clarity without judgment.

## Requirements

- Model a household with linked accounts, transactions, budgets, and categories
- Exactly one active budget per household; partners share a household view with a privacy boundary for personal categories
- Primary flows: onboarding, account linking, weekly review, category adjustment, spending alerts
- Handle sync failures, duplicate transactions, empty accounts, and zero-income months without data loss or blame UX
- Never display investment advice or tax filing guidance
- Accessible mobile UI (screen-reader labels, large touch targets, status not by color alone)`,
    context: `## Business goals
Launch a budgeting app that reaches 40% weekly active usage within 90 days by reducing financial anxiety through clarity.

## Users
- Primary budgeter (25–40) managing the household budget
- Partner with shared visibility and personal privacy needs
- Occasional viewer (e.g. co-parent checking balances)

## Constraints
- Mobile-first (iOS and Android); US market only
- Offline viewing of balances required; sync may fail and must recover
- No investment or tax advice anywhere in the product
- Prefer clarity over transaction-level granularity when they conflict`,
    golden: {
      required_entities: ['household', 'account', 'transaction', 'budget', 'category'],
      required_invariants: ['one_active_budget_per_household', 'partner_privacy_boundary', 'no_investment_advice_display'],
      required_personas: ['primary_budgeter', 'partner', 'occasional_viewer'],
      required_flows: ['onboarding', 'account_linking', 'weekly_review', 'category_adjustment', 'spending_alert'],
      required_rules: ['no_investment_advice', 'shared_household_view', 'privacy_between_partners'],
      required_scenarios: ['sync_failure_recovery', 'zero_income_month', 'duplicate_transaction_handling'],
      required_edge_cases: ['empty_accounts', 'sync_failure', 'duplicate_transactions', 'zero_income_month'],
      required_a11y: ['screen_reader_labels', 'large_touch_targets', 'color_not_only_indicator'],
      required_tradeoffs: ['clarity_vs_granularity', 'shared_view_vs_partner_privacy'],
      required_sections: V2_SECTIONS,
    },
  },
  {
    id: 'task002',
    category: 'greenfield',
    workflow: 'design',
    fixture: null,
    human_eval: true,
    prompt: 'Design the product behavior for multi-provider clinic appointment scheduling: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Clinic Appointment Scheduling

Build a **minimal vertical slice** of patient-facing scheduling for a multi-specialty clinic network: book, reschedule, cancel, and join a waitlist across providers and locations.

## Requirements

- Support patients and caregivers booking for dependents; front-desk staff handle exceptions
- Enforce one booking per slot; gate booking on insurance verification status
- Flows: book, reschedule, cancel (with policy), insurance check, waitlist when no availability
- No PHI in URLs or notifications; handle timezone confusion and same-day cancellations
- Recover when insurance is denied; offer waitlist when no slots exist
- Keyboard-accessible forms with announced errors and adequate contrast`,
    context: `## Business goals
Cut call-center scheduling volume by 50% within 6 months without increasing no-shows or compliance risk.

## Users
- Patients (18+) booking for themselves
- Caregivers booking for dependents
- Front-desk staff resolving exceptions the self-serve flow cannot

## Constraints
- HIPAA-aware UX (no PHI in URLs or push/SMS bodies)
- Integrates with an existing EHR scheduling backend (assume API exists)
- English and Spanish at launch
- Trade-off: real-time eligibility accuracy vs booking speed — pick and document one`,
    golden: {
      required_entities: ['patient', 'appointment', 'provider', 'insurance_plan', 'location'],
      required_invariants: ['no_phi_in_urls', 'insurance_gate_before_booking', 'one_booking_per_slot'],
      required_personas: ['patient', 'caregiver', 'front_desk_staff'],
      required_flows: ['book_appointment', 'reschedule', 'cancel', 'insurance_check', 'waitlist_join'],
      required_rules: ['cancellation_policy', 'insurance_verification_gate', 'provider_availability'],
      required_scenarios: ['insurance_denied_recovery', 'timezone_confusion_handling', 'no_availability_waitlist'],
      required_edge_cases: ['no_availability', 'insurance_denied', 'same_day_cancellation', 'timezone_confusion'],
      required_a11y: ['keyboard_navigation', 'form_error_announcement', 'contrast_compliance'],
      required_tradeoffs: ['real_time_eligibility_vs_booking_speed'],
      required_sections: V2_SECTIONS,
    },
  },
  {
    id: 'task003',
    category: 'greenfield',
    workflow: 'design',
    fixture: null,
    human_eval: false,
    prompt: 'Design the product behavior for a volunteer management platform for nonprofit coordinators: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Volunteer Management Platform

Build a **minimal vertical slice** for nonprofit coordinators to post opportunities, fill shifts, and track volunteer hours — with certification and background-check gates.

## Requirements

- Entities: organization, opportunity, shift, volunteer, certification
- Enforce shift capacity, minimum age, and background-check-before-assignment
- Flows: post opportunity, volunteer signup, on-site check-in, hours reporting
- Handle no-shows, last-minute cancels, expired certifications, and overbook prevention
- Mobile-friendly for volunteers on-site; simple language and screen-reader support
- Balance coordinator control vs volunteer self-serve flexibility`,
    context: `## Business goals
Increase volunteer retention by 30% and cut coordinator admin time by making signup and hours tracking self-serve.

## Users
- Nonprofit coordinators posting and staffing shifts
- Volunteers (ages 16–70) discovering and completing shifts
- Organization admins setting policy (age, background checks)

## Constraints
- Third-party background-check API; SMS shift reminders
- Free tier for small nonprofits
- Certifications can expire and must block assignment until renewed`,
    golden: {
      required_entities: ['opportunity', 'shift', 'volunteer', 'certification', 'organization'],
      required_invariants: ['shift_capacity_not_exceeded', 'background_check_before_assignment', 'min_age_enforced'],
      required_personas: ['coordinator', 'volunteer', 'org_admin'],
      required_flows: ['post_opportunity', 'volunteer_signup', 'shift_checkin', 'hours_reporting'],
      required_rules: ['background_check_required', 'min_age_requirement', 'shift_capacity'],
      required_scenarios: ['no_show_handling', 'certification_expired_block', 'overbooked_shift_prevention'],
      required_edge_cases: ['no_show', 'certification_expired', 'overbooked_shift', 'last_minute_cancel'],
      required_a11y: ['screen_reader_support', 'simple_language_mode'],
      required_tradeoffs: ['coordinator_control_vs_volunteer_flexibility'],
      required_sections: V2_SECTIONS,
    },
  },
  {
    id: 'task004',
    category: 'greenfield',
    workflow: 'design',
    fixture: null,
    human_eval: false,
    prompt: 'Design the product behavior for a collaborative travel itinerary planner for friend groups: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Travel Itinerary Planner

Build a **minimal vertical slice** of a collaborative trip planner for friend groups: shared itinerary, activity voting, and expense split/settle.

## Requirements

- Invite-only trip access; organizer approval for material itinerary changes
- Entities: trip, itinerary item, expense, member, vote
- Flows: create trip, add activity, vote on options, split expense, settle up
- Expense currency must stay consistent within a trip; handle member leaving mid-settlement
- Resolve conflicting votes; reconcile offline edits when connectivity returns
- Offline access during travel; maps need a non-visual alternative`,
    context: `## Business goals
Reach 100K trip plans in year one with 25% converting to premium (unlimited trips + expense export).

## Users
- Trip organizer (25–45) owning the plan
- Contributors adding ideas and expenses
- Passive members who mostly view

## Constraints
- iOS and Android native apps; Google Maps + calendar integration
- Premium unlocks unlimited trips and expense export
- Trade-offs: collaboration vs organizer control; offline access vs live sync`,
    golden: {
      required_entities: ['trip', 'itinerary_item', 'expense', 'member', 'vote'],
      required_invariants: ['invite_only_trip_access', 'organizer_approval_for_changes', 'expense_currency_consistency'],
      required_personas: ['trip_organizer', 'contributor', 'passive_member'],
      required_flows: ['create_trip', 'add_activity', 'vote_on_option', 'split_expense', 'settle_up'],
      required_rules: ['invite_only_access', 'organizer_approval', 'expense_currency'],
      required_scenarios: ['member_leaves_group_settlement', 'conflicting_votes_resolution', 'offline_sync_reconciliation'],
      required_edge_cases: ['member_leaves_group', 'conflicting_votes', 'offline_sync', 'timezone_changes'],
      required_a11y: ['readable_maps_alternative', 'notification_preferences'],
      required_tradeoffs: ['collaboration_vs_organizer_control', 'offline_access_vs_live_sync'],
      required_sections: V2_SECTIONS,
    },
  },
  {
    id: 'task005',
    category: 'greenfield',
    workflow: 'design',
    fixture: null,
    human_eval: false,
    prompt: 'Design the product behavior for a personal fitness tracker focused on habit formation: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Habit-Focused Fitness Tracker

Build a **minimal vertical slice** of a fitness app that prioritizes sustainable habits over competitive metrics: daily check-ins, forgiving streaks, and opt-in close-friend accountability.

## Requirements

- Entities: habit, check-in, streak, friend connection
- No public leaderboards; social features are opt-in only
- Streaks use a forgiveness policy (missed days recoverable) — never punitive wipeouts as the default
- Flows: habit setup, daily check-in, streak recovery, optional friend challenge
- Handle health-sync failures and declined friend requests gracefully
- No weight-focused default dashboards; support reduced-motion and VoiceOver labels`,
    context: `## Business goals
60-day retention above 40%; differentiate from metric-heavy competitors through low-pressure habit formation.

## Users
- Beginners intimidated by gym culture (25–55)
- Returning athletes rebuilding consistency
- Accountability partners (close friends only)

## Constraints
- Integrates with Apple Health / Google Fit
- No public leaderboards; privacy-first social
- Trade-offs: accountability vs pressure; streak motivation vs forgiveness`,
    golden: {
      required_entities: ['habit', 'checkin', 'streak', 'friend_connection'],
      required_invariants: ['no_public_leaderboard', 'opt_in_social_only', 'streak_forgiveness_policy'],
      required_personas: ['beginner', 'returning_athlete', 'accountability_partner'],
      required_flows: ['daily_checkin', 'habit_setup', 'streak_recovery', 'friend_challenge'],
      required_rules: ['no_public_leaderboard', 'opt_in_social', 'streak_forgiveness'],
      required_scenarios: ['missed_day_recovery', 'health_sync_failure', 'friend_request_declined'],
      required_edge_cases: ['missed_day', 'health_sync_failure', 'friend_request_declined'],
      required_a11y: ['motion_reduced_mode', 'voiceover_labels'],
      required_tradeoffs: ['accountability_vs_pressure', 'streak_motivation_vs_forgiveness'],
      required_sections: V2_SECTIONS,
    },
  },
  // OSS Feature (5)
  {
    id: 'task006',
    category: 'oss_feature',
    workflow: 'design',
    fixture: 'plane-with-init',
    human_eval: true,
    oss: { repo: 'makeplane/plane', commit: 'dc9d80b2d2a499b967f0b541e083b283f463719f' },
    prompt: 'Design the product behavior for a recurring tasks feature in Plane: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief that fits the existing product.',
    description: `# Recurring Tasks for Plane

Design and implement a **minimal vertical slice** of recurring issues in Plane that fits existing projects, cycles, assignees, and permissions.

## Requirements

- Create a recurring issue series (daily, weekly, monthly, custom) that spawns occurrences
- Complete vs skip a single occurrence; edit series vs single occurrence; end recurrence
- One occurrence per schedule slot; assignees inherit from the series; respect project permissions
- Handle timezone display, cycle-boundary conflicts, deleted projects, and permission-denied occurrences
- Show recurrence clearly in list and detail views without breaking Kanban/List patterns
- Keyboard shortcuts and screen-reader-friendly recurrence descriptions`,
    context: `## Business goals
Reduce repetitive issue creation for team leads running standup rituals, releases, and ops checklists inside Plane.

## Users
- Team leads creating and managing series
- Individual contributors completing or skipping occurrences

## Constraints
- Brownfield: must fit Plane's issue states, cycles, modules, labels, and project permissions
- See product-context.md in the workspace for existing UX (sidebar, Kanban/List)
- Trade-offs: series edit vs single-occurrence edit; timezone consistency vs local display`,
    golden: {
      required_entities: ['recurring_issue', 'occurrence', 'issue', 'project', 'cycle'],
      required_invariants: ['one_occurrence_per_schedule_slot', 'assignee_inheritance_on_series', 'recurrence_respects_project_permissions'],
      required_personas: ['team_lead', 'individual_contributor'],
      required_flows: ['create_recurrence', 'complete_occurrence', 'skip_occurrence', 'edit_series', 'end_recurrence'],
      required_rules: ['recurrence_end_conditions', 'timezone_handling', 'assignee_inheritance'],
      required_scenarios: ['deleted_project_series_handling', 'permission_denied_occurrence', 'cycle_boundary_conflict'],
      required_edge_cases: ['deleted_project', 'permission_denied', 'cycle_boundary', 'duplicate_occurrence'],
      required_a11y: ['keyboard_shortcuts', 'screen_reader_recurrence_description'],
      required_tradeoffs: ['series_edit_vs_single_occurrence_edit', 'timezone_consistency_vs_user_local_display'],
      required_sections: [...V2_SECTIONS.slice(0, 4), 'tradeoffs and decisions', 'implementation brief'],
    },
  },
  {
    id: 'task007',
    category: 'oss_feature',
    workflow: 'design',
    fixture: 'commerce-with-init',
    human_eval: true,
    oss: { repo: 'vercel/commerce', commit: '3761e52e60df9c6a316e067dbfd7032e494d3634' },
    prompt: 'Design the product behavior for a wishlist feature on the storefront: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief that fits the existing product.',
    description: `# Wishlist Feature

Design and implement a **minimal vertical slice** of wishlist on the Vercel Commerce storefront for guests and registered shoppers.

## Requirements

- Add/remove products from wishlist while browsing; view wishlist; move items to cart (single or bulk)
- Guest wishlist persists across the session and merges into the account wishlist on login
- Share wishlist via link with optional privacy; support gift-buyer browsing
- Out-of-stock items are not purchasable from wishlist; show price at add-time; notify on material price changes
- Handle discontinued products, expired guest sessions, empty wishlist, and duplicate-add idempotency
- Accessible wishlist controls and bulk-action feedback`,
    context: `## Business goals
Increase return visits and conversion by letting shoppers save products without committing to cart.

## Users
- Guest shoppers saving items before account creation
- Registered users managing a persistent wishlist
- Gift buyers shopping from a shared list

## Constraints
- Brownfield Next.js Commerce storefront — fit product listing, PDP, cart, and checkout
- Guest persistence vs privacy; price notifications vs notification noise
- Existing flows to extend: product listing, product detail, cart, checkout`,
    golden: {
      required_entities: ['wishlist', 'wishlist_item', 'product', 'cart', 'guest_session'],
      required_invariants: ['guest_wishlist_merge_on_login', 'out_of_stock_not_purchasable', 'price_at_add_time_displayed'],
      required_personas: ['guest_shopper', 'registered_user', 'gift_buyer'],
      required_flows: ['add_to_wishlist', 'view_wishlist', 'move_to_cart', 'share_wishlist', 'guest_merge'],
      required_rules: ['guest_persistence', 'out_of_stock_handling', 'price_change_notification'],
      required_scenarios: ['guest_session_expired_recovery', 'product_discontinued_removal', 'duplicate_add_idempotency'],
      required_edge_cases: ['product_discontinued', 'guest_session_expired', 'empty_wishlist', 'duplicate_add'],
      required_a11y: ['wishlist_button_label', 'bulk_action_feedback'],
      required_tradeoffs: ['guest_persistence_vs_privacy', 'price_notification_vs_noise'],
      required_sections: V2_SECTIONS,
    },
  },
  {
    id: 'task008',
    category: 'oss_feature',
    workflow: 'design',
    fixture: 'outline-with-init',
    human_eval: false,
    oss: { repo: 'outline/outline', commit: '30730179b852d42da5078a9294f7d05a44f516b7' },
    prompt: 'Design the product behavior for guest sharing of Outline documents: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief that fits the existing product.',
    description: `# Guest Document Sharing

Design and implement a **minimal vertical slice** of guest sharing for Outline documents: invite/link access, comment-or-view permissions, expiry, and revocation.

## Requirements

- Share via link or email invite; guest may view or comment (configurable); revoke immediately
- Expired links deny access; guest permissions are a subset of the document's member permissions
- Flows: share with guest, guest access, revoke, comment as guest
- Handle guest email mismatch, documents moved across collections, and collection vs document permission conflicts
- Clear guest-vs-member indicators; audit trail of share/revoke events
- Trade-off: link convenience vs security; comment access vs read-only`,
    context: `## Business goals
Enable external collaboration (clients, contractors) without forcing full workspace membership.

## Users
- Document authors sharing externally
- Team members co-owning docs
- External guests with limited access

## Constraints
- Brownfield Outline: collections, real-time editing, collection-level permissions, @mentions, inline comments
- Revocation must take effect immediately; expiry policy is mandatory for public links
- See product-context.md in the workspace if present`,
    golden: {
      required_entities: ['document', 'guest_invite', 'collection', 'permission', 'share_link'],
      required_invariants: ['expired_link_denies_access', 'guest_permissions_subset_of_document', 'revocation_immediate'],
      required_personas: ['document_author', 'team_member', 'external_guest'],
      required_flows: ['share_with_guest', 'guest_access', 'revoke_access', 'comment_as_guest'],
      required_rules: ['expiration_policy', 'permission_levels', 'audit_trail'],
      required_scenarios: ['expired_link_access_denied', 'guest_email_mismatch', 'collection_permission_conflict'],
      required_edge_cases: ['expired_link', 'guest_email_mismatch', 'document_moved', 'collection_permission_conflict'],
      required_a11y: ['permission_status_visible', 'guest_mode_indicator'],
      required_tradeoffs: ['link_sharing_convenience_vs_security', 'comment_access_vs_read_only'],
      required_sections: [...V2_SECTIONS.slice(0, 4), 'tradeoffs and decisions', 'implementation brief'],
    },
  },
  {
    id: 'task009',
    category: 'oss_feature',
    workflow: 'design',
    fixture: 'commerce-with-init',
    human_eval: false,
    oss: { repo: 'vercel/commerce', commit: '3761e52e60df9c6a316e067dbfd7032e494d3634' },
    prompt: 'Design the product behavior for saved searches in the product catalog: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief that fits the existing product.',
    description: `# Saved Searches

Design and implement a **minimal vertical slice** of saved catalog searches on Vercel Commerce: save filters, re-run, edit, and optional match notifications.

## Requirements

- Save named filter combinations (category, price, attributes); enforce a max number of saved searches
- Filter snapshot stays immutable until the user explicitly edits it
- Flows: save, run, edit, notification opt-in with frequency limits
- Prevent duplicate names; handle deprecated filters and "no new matches" notification states
- Entry points: account settings and search bar
- Announce search results and persist filter state accessibly`,
    context: `## Business goals
Help frequent and B2B shoppers return to complex filter sets and discover new matching inventory without re-building searches.

## Users
- Frequent shoppers with repeat filter patterns
- B2B buyers monitoring catalog changes

## Constraints
- Brownfield Commerce catalog with existing search, filters, and collections
- Cap saved searches; throttle notification frequency vs relevance
- Notifications are optional and must degrade cleanly when filters become invalid`,
    golden: {
      required_entities: ['saved_search', 'filter', 'product', 'notification'],
      required_invariants: ['max_saved_searches_enforced', 'filter_snapshot_immutable_until_edit'],
      required_personas: ['frequent_shopper', 'b2b_buyer'],
      required_flows: ['save_search', 'run_saved_search', 'edit_saved_search', 'notification_opt_in'],
      required_rules: ['max_saved_searches', 'notification_frequency'],
      required_scenarios: ['no_new_matches_notification', 'filter_deprecated_handling', 'duplicate_name_prevention'],
      required_edge_cases: ['no_new_matches', 'filter_deprecated', 'duplicate_name'],
      required_a11y: ['search_results_announcement', 'filter_state_persistence'],
      required_tradeoffs: ['notification_frequency_vs_relevance'],
      required_sections: V2_SECTIONS,
    },
  },
  {
    id: 'task010',
    category: 'oss_feature',
    workflow: 'design',
    fixture: 'plane-with-init',
    human_eval: false,
    oss: { repo: 'makeplane/plane', commit: 'dc9d80b2d2a499b967f0b541e083b283f463719f' },
    prompt: 'Design the product behavior for bulk actions on issues in Plane: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief that fits the existing product.',
    description: `# Bulk Issue Actions

Design and implement a **minimal vertical slice** of multi-select bulk actions for Plane issues across List and Kanban views.

## Requirements

- Multi-select issues; bulk change state, assignee, labels, cycle, module; confirm destructive actions
- Permission checked per issue; partial failures reported clearly; undo window for destructive bulk ops
- Enforce max selection size; block mixed-project selections that would violate project boundaries
- Handle selection across pages and partial permission denial without silent skips
- Announce selection count; support keyboard multi-select
- Trade-off: bulk speed vs per-item confirmation; cross-page selection vs performance`,
    context: `## Business goals
Let team leads and PMs triage large backlogs without opening issues one-by-one.

## Users
- Team leads doing weekly triage
- Project managers running sprint hygiene

## Constraints
- Brownfield Plane: List, Kanban, Calendar views; existing issue permissions and project scoping
- Destructive bulk actions need confirmation + short undo window
- See product-context.md in the workspace for navigation and issue model`,
    golden: {
      required_entities: ['issue', 'bulk_selection', 'permission', 'project'],
      required_invariants: ['permission_check_per_issue', 'undo_window_for_destructive', 'max_selection_enforced'],
      required_personas: ['team_lead', 'project_manager'],
      required_flows: ['multi_select', 'bulk_state_change', 'bulk_assign', 'bulk_delete_confirm'],
      required_rules: ['permission_check_per_issue', 'undo_window', 'max_selection'],
      required_scenarios: ['partial_permission_denied_feedback', 'mixed_project_selection_block', 'selection_across_pages'],
      required_edge_cases: ['partial_permission_denied', 'mixed_project_selection', 'selection_across_pages'],
      required_a11y: ['selection_count_announced', 'keyboard_multi_select'],
      required_tradeoffs: ['bulk_speed_vs_per_item_confirmation', 'cross_page_selection_vs_performance'],
      required_sections: V2_SECTIONS,
    },
  },
  // OSS Behavior Audit (5)
  {
    id: 'task011',
    category: 'oss_audit',
    workflow: 'audit',
    fixture: 'commerce-audit-ready',
    human_eval: true,
    oss: { repo: 'vercel/commerce', commit: '3761e52e60df9c6a316e067dbfd7032e494d3634' },
    prompt: 'Audit the checkout flow for product-behavior gaps: invariant violations, state consistency failures, permission issues, error recovery, and prioritized fixes.',
    description: `# Checkout Flow Audit

Audit the Vercel Commerce checkout path for product-behavior gaps, then implement a **minimal vertical slice** of the highest-priority fixes.

## Scope

- Cart review → shipping → payment → order confirmation
- Guest and authenticated checkout
- Totals consistency, payment-before-confirm, address validation, declined payment recovery
- Session timeout mid-checkout, idempotency risks, form accessibility (labels, errors, keyboard)

## Deliverable

- Findings covering invariant violations, state consistency, permission gaps, error recovery, and idempotency
- Prioritized fixes; implement the top slice that hardens checkout behavior in code`,
    context: `## Business goals
Reduce checkout abandonment and payment-support tickets caused by inconsistent totals, failed recovery, and unclear errors.

## Users
- First-time buyers (often guest checkout)
- Returning customers with saved details

## Constraints
- Brownfield Next.js Commerce; review source and any \`.lamina/\` flow inventory if present
- Do not redesign the entire storefront — fix checkout behavior gaps
- Payment must be required before confirmation; order total must match line items`,
    golden: {
      required_entities: ['cart', 'order', 'payment', 'shipping_address'],
      required_invariants: ['order_total_matches_line_items', 'payment_required_before_confirmation'],
      required_personas: ['first_time_buyer', 'returning_customer'],
      required_flows: ['cart_review', 'shipping_entry', 'payment', 'confirmation'],
      required_findings: ['invariant_violation', 'state_consistency', 'permission_gap', 'error_recovery', 'idempotency_risk'],
      required_scenarios: ['payment_declined_recovery', 'address_validation_failure', 'session_timeout_mid_checkout'],
      required_edge_cases: ['payment_declined', 'address_validation_failure', 'session_timeout'],
      required_a11y: ['form_labels', 'error_announcement', 'keyboard_checkout'],
      required_sections: AUDIT_SECTIONS,
    },
  },
  {
    id: 'task012',
    category: 'oss_audit',
    workflow: 'audit',
    fixture: 'plane-audit-ready',
    human_eval: true,
    oss: { repo: 'makeplane/plane', commit: 'dc9d80b2d2a499b967f0b541e083b283f463719f' },
    prompt: 'Audit project settings and configuration in Plane for product-behavior gaps: invariant violations, state consistency failures, permission issues, error recovery, and prioritized fixes.',
    description: `# Project Settings Audit

Audit Plane project settings and configuration for product-behavior gaps, then implement a **minimal vertical slice** of the highest-priority fixes.

## Scope

- Project creation/configuration, member invite/roles, workflow states, integration settings
- Last-admin protection, role/permission consistency, destructive-action guards
- Multi-view inconsistency and inheritance confusion in settings UX
- Invalid invites and conflicting settings recovery

## Deliverable

- Findings on permission clarity, destructive guards, multi-view inconsistency, inheritance confusion
- Prioritized fixes (including quick wins); implement the top slice in code`,
    context: `## Business goals
Prevent admin lockouts and permission mistakes that block teams from using Plane safely.

## Users
- Project admins configuring projects and roles
- Team members affected by role and workflow changes

## Constraints
- Brownfield Plane settings used by team leads and admins
- Last admin must not be removable; role permissions must stay consistent after edits
- Prefer targeted fixes over a settings redesign`,
    golden: {
      required_entities: ['project', 'member', 'role', 'workflow_state'],
      required_invariants: ['last_admin_cannot_be_removed', 'role_permissions_consistent'],
      required_personas: ['project_admin', 'team_member'],
      required_flows: ['project_settings', 'member_invite', 'role_management'],
      required_findings: ['permission_clarity', 'destructive_action_guards', 'multi_view_inconsistency', 'inheritance_confusion'],
      required_scenarios: ['last_admin_removal_blocked', 'invalid_invite_handling', 'settings_conflict_resolution'],
      required_edge_cases: ['last_admin_removal', 'invalid_invite', 'settings_conflict'],
      required_a11y: ['settings_navigation', 'toggle_labels'],
      required_sections: [...AUDIT_SECTIONS.slice(0, 2), 'quick wins'],
    },
  },
  {
    id: 'task013',
    category: 'oss_audit',
    workflow: 'audit',
    fixture: 'outline-audit-ready',
    human_eval: false,
    oss: { repo: 'outline/outline', commit: '30730179b852d42da5078a9294f7d05a44f516b7' },
    prompt: 'Audit document sharing and permissions in Outline for product-behavior gaps: invariant violations, state consistency failures, permission issues, error recovery, and prioritized fixes.',
    description: `# Document Sharing Audit

Audit Outline document sharing and permissions for product-behavior gaps, then implement a **minimal vertical slice** of the highest-priority fixes.

## Scope

- Share dialog, permission levels, collection vs document permissions, public links
- Inheritance bounds (document permissions bounded by collection), immediate revocation
- Permission downgrade propagation, link leak after revoke, access after document move
- Share-dialog focus and visible permission status

## Deliverable

- Findings on inheritance gaps, invariant violations, revocation failures, multi-view inconsistency
- Prioritized fixes; implement the top slice that hardens sharing invariants in code`,
    context: `## Business goals
Stop accidental data exposure from sharing/permission bugs while keeping collaboration usable.

## Users
- Authors sharing documents
- Viewers and workspace admins managing access

## Constraints
- Brownfield Outline collections, documents, and granular permissions
- Revoked access and expired/public links must not continue to work
- Audit inheritance conflicts between collection and document levels`,
    golden: {
      required_entities: ['document', 'collection', 'permission', 'share_link'],
      required_invariants: ['document_permissions_bounded_by_collection', 'revoked_access_immediate'],
      required_personas: ['author', 'viewer', 'admin'],
      required_flows: ['share_document', 'change_permissions', 'public_link'],
      required_findings: ['permission_inheritance_gap', 'invariant_violation', 'revocation_failure', 'multi_view_inconsistency'],
      required_scenarios: ['permission_downgrade_propagation', 'link_leak_after_revocation', 'moved_document_access'],
      required_edge_cases: ['permission_downgrade', 'link_leak', 'moved_document'],
      required_a11y: ['permission_status', 'share_dialog_focus'],
      required_sections: AUDIT_SECTIONS,
    },
  },
  {
    id: 'task014',
    category: 'oss_audit',
    workflow: 'audit',
    fixture: 'commerce-audit-ready',
    human_eval: false,
    oss: { repo: 'vercel/commerce', commit: '3761e52e60df9c6a316e067dbfd7032e494d3634' },
    prompt: 'Audit the cart experience for product-behavior friction and abandonment risks: invariant violations, state consistency failures, permission issues, error recovery, and prioritized fixes.',
    description: `# Cart Experience Audit

Audit the Vercel Commerce cart for behavioral friction, state consistency, and abandonment risks, then implement a **minimal vertical slice** of the highest-priority fixes.

## Scope

- Add-to-cart feedback, cart modal/page, quantity updates, remove item, proceed to checkout
- Cart total matches items; out-of-stock items not checkoutable
- Price-change transparency, empty-cart recovery, idempotent quantity updates
- Announced cart updates and accessible quantity controls

## Deliverable

- Findings on state consistency, idempotency, price transparency, inventory invariants
- Prioritized fixes; implement the top slice that reduces cart abandonment risk in code`,
    context: `## Business goals
Reduce cart abandonment from stale prices, stock surprises, and unclear quantity/total feedback.

## Users
- Browsing shoppers adding items casually
- Ready-to-buy shoppers updating quantity and checking out

## Constraints
- Brownfield Commerce cart (modal + page)
- Totals and inventory state must stay consistent with line items
- Prefer behavioral fixes over visual redesign`,
    golden: {
      required_entities: ['cart', 'cart_item', 'product', 'price'],
      required_invariants: ['cart_total_matches_items', 'out_of_stock_not_checkoutable'],
      required_personas: ['browsing_shopper', 'ready_to_buy'],
      required_flows: ['add_to_cart', 'update_quantity', 'remove_item', 'proceed_checkout'],
      required_findings: ['state_consistency', 'idempotency_risk', 'price_transparency_gap', 'inventory_invariant_violation'],
      required_scenarios: ['out_of_stock_in_cart_handling', 'price_change_notification', 'empty_cart_recovery'],
      required_edge_cases: ['out_of_stock_in_cart', 'price_change', 'empty_cart'],
      required_a11y: ['cart_updates_announced', 'quantity_controls'],
      required_sections: AUDIT_SECTIONS.slice(0, 2),
    },
  },
  {
    id: 'task015',
    category: 'oss_audit',
    workflow: 'audit',
    fixture: 'plane-audit-ready',
    human_eval: false,
    oss: { repo: 'makeplane/plane', commit: 'dc9d80b2d2a499b967f0b541e083b283f463719f' },
    prompt: 'Audit new-user onboarding in Plane for product-behavior gaps: invariant violations, state consistency failures, permission issues, error recovery, and prioritized fixes.',
    description: `# Onboarding Audit

Audit Plane new-team onboarding for behavioral gaps and time-to-value blockers, then implement a **minimal vertical slice** of the highest-priority fixes.

## Scope

- Workspace creation (requires owner), first project, invite teammates, first issue
- Invite expiry/TTL and expired-invite recovery
- Solo-user path, abandoned-setup resume, empty-state guidance, permission confusion
- Clear onboarding step labels for assistive tech

## Deliverable

- Findings on empty-state guidance gaps, workflow dead ends, permission confusion, time-to-value blockers
- Prioritized fixes (including quick wins); implement the top slice that unblocks first value in code`,
    context: `## Business goals
Get new teams to a useful first project + issue quickly without admin dead ends or expired-invite traps.

## Users
- New workspace admins setting up Plane
- Invited members joining via invite link

## Constraints
- Brownfield Plane onboarding for new teams
- Workspace must have an owner; invites expire after TTL and need a recovery path
- Support solo users who skip invites`,
    golden: {
      required_entities: ['workspace', 'project', 'invite', 'issue'],
      required_invariants: ['workspace_requires_owner', 'invite_expires_after_ttl'],
      required_personas: ['new_admin', 'invited_member'],
      required_flows: ['workspace_setup', 'first_project', 'invite_team'],
      required_findings: ['empty_state_guidance_gap', 'workflow_dead_end', 'permission_confusion', 'time_to_value_blocker'],
      required_scenarios: ['solo_user_onboarding_path', 'invite_expired_recovery', 'abandoned_setup_resume'],
      required_edge_cases: ['solo_user', 'invite_expired', 'abandoned_setup'],
      required_a11y: ['onboarding_step_labels'],
      required_sections: [...AUDIT_SECTIONS.slice(0, 2), 'quick wins'],
    },
  },
  // Workflow & edge cases (5)
  {
    id: 'task016',
    category: 'workflow_edge',
    workflow: 'design',
    fixture: null,
    human_eval: true,
    prompt: 'Design the product behavior for healthcare appointment scheduling with complex insurance rules: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Healthcare Scheduling with Insurance Rules

Build a **minimal vertical slice** focused on insurance-gated scheduling — not general clinic booking. Eligibility, prior auth, network status, and copay disclosure control whether and how a patient can book.

## Requirements

- Verify eligibility before booking; prior auth can block scheduling until approved (24–72h)
- Distinct flows: in-network book, out-of-network option, prior-auth wait, eligibility retry on timeout
- Display estimated copay before confirm; never guarantee coverage — show disclaimers
- Handle partial coverage messaging, auth denial with alternatives, and plan change mid-booking
- Plain-language insurance copy and recoverable error paths
- Trade-off: real-time eligibility wait vs booking speed; in-network restriction vs patient choice`,
    context: `## Business goals
Reduce no-shows and day-of insurance surprises; stay compliant while keeping scheduling usable.

## Users
- Patients booking under insurance constraints
- Scheduling staff assisting when automation blocks
- Insurance coordinators working prior-auth queues

## Constraints
- This task is about insurance rules as the workflow edge — not multi-provider calendar UX broadly
- Cannot guarantee coverage; prior auth may take 24–72 hours
- Eligibility APIs can time out and must be retryable`,
    golden: {
      required_entities: ['patient', 'appointment', 'insurance_plan', 'prior_authorization'],
      required_invariants: ['eligibility_verified_before_booking', 'prior_auth_blocks_scheduling', 'copay_displayed_before_confirm'],
      required_personas: ['patient', 'scheduler', 'insurance_coordinator'],
      required_flows: ['eligibility_check', 'book_in_network', 'prior_auth_wait', 'out_of_network_option'],
      required_rules: ['insurance_verification_gate', 'prior_auth_required', 'copay_display'],
      required_scenarios: ['eligibility_timeout_retry', 'partial_coverage_communication', 'auth_denied_alternative', 'plan_change_mid_booking'],
      required_edge_cases: ['eligibility_timeout', 'partial_coverage', 'auth_denied', 'plan_change_mid_booking'],
      required_a11y: ['plain_language_insurance', 'error_recovery_paths'],
      required_tradeoffs: ['real_time_eligibility_vs_wait_time', 'in_network_restriction_vs_patient_choice'],
      required_sections: [...V2_SECTIONS.slice(0, 4), 'policy enforcement', 'implementation brief'],
    },
  },
  {
    id: 'task017',
    category: 'workflow_edge',
    workflow: 'design',
    fixture: null,
    human_eval: true,
    prompt: 'Design the product behavior for an expense reimbursement approval workflow: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Expense Reimbursement Workflow

Build a **minimal vertical slice** of multi-step expense reimbursement: employee submit → manager approve → finance review → payment, with policy enforcement and an immutable audit trail.

## Requirements

- Receipt required above $25; category/role policy limits; no payment without finance approval
- Flows: submit, manager approve/reject-with-reason, finance review, payment initiated
- Handle policy-violation escalation, manager OOO delegation, duplicate submission idempotency, currency conversion rounding
- Partial approvals allowed where policy permits; auditors can read the trail but not alter it
- Clear form validation and status tracking
- Trade-off: approval speed vs policy enforcement; delegation flexibility vs audit clarity`,
    context: `## Business goals
Cut reimbursement cycle time from 14 days to 5 without weakening policy or auditability.

## Users
- Employees submitting expenses
- Managers approving or delegating while OOO
- Finance reviewers releasing payment
- Auditors reading the immutable trail

## Constraints
- Policy limits by category and role; receipt required above $25
- Multi-currency for travel; conversion rounding must be deterministic
- Delegation must remain attributable in the audit trail`,
    golden: {
      required_entities: ['expense', 'approval', 'receipt', 'policy', 'payment'],
      required_invariants: ['receipt_required_above_threshold', 'audit_trail_immutable', 'no_payment_without_finance_approval'],
      required_personas: ['employee', 'manager', 'finance_reviewer'],
      required_flows: ['submit_expense', 'manager_approve', 'finance_review', 'payment_initiated', 'reject_with_reason'],
      required_rules: ['receipt_threshold', 'category_limits', 'delegation_rules'],
      required_scenarios: ['policy_violation_escalation', 'manager_ooo_delegation', 'duplicate_submission_idempotency', 'currency_conversion_rounding'],
      required_edge_cases: ['policy_violation', 'manager_ooo', 'duplicate_submission', 'currency_conversion'],
      required_a11y: ['form_validation_feedback', 'status_tracking'],
      required_tradeoffs: ['approval_speed_vs_policy_enforcement', 'delegation_flexibility_vs_audit_clarity'],
      required_sections: [...V2_SECTIONS.slice(0, 4), 'state management', 'implementation brief'],
    },
  },
  {
    id: 'task018',
    category: 'workflow_edge',
    workflow: 'design',
    fixture: null,
    human_eval: false,
    prompt: 'Design the product behavior for subscription billing with upgrades, downgrades, and proration: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Subscription Billing Workflow

Build a **minimal vertical slice** of SaaS subscription plan changes: immediate prorated upgrades, end-of-period downgrades, failed-payment grace, and invoice clarity.

## Requirements

- Upgrade charges prorated immediately; downgrade takes effect at period end
- Grace period before suspension on failed payment; clear invoice history and upcoming charges
- Flows: upgrade, downgrade, payment-failed recovery, view invoice
- Handle expired card recovery, chargebacks, discontinued-plan migration, usage-addon overage
- Billing status and charge preview must be unambiguous
- Trade-off: immediate upgrade revenue vs user surprise; grace length vs churn risk`,
    context: `## Business goals
Reduce billing support tickets by 40% by making plan changes and failures predictable.

## Users
- Account owners changing plans and payment methods
- Team admins with billing visibility (not always payment authority)

## Constraints
- Stripe integration; monthly and annual plans; usage-based add-ons
- Never suspend during an active grace period without warning
- Show charge preview before confirming upgrades`,
    golden: {
      required_entities: ['subscription', 'plan', 'invoice', 'payment_method', 'usage_addon'],
      required_invariants: ['downgrade_effective_end_of_period', 'proration_on_upgrade', 'grace_period_before_suspension'],
      required_personas: ['account_owner', 'team_admin'],
      required_flows: ['upgrade_plan', 'downgrade_plan', 'payment_failed_recovery', 'view_invoice'],
      required_rules: ['proration_policy', 'downgrade_timing', 'grace_period'],
      required_scenarios: ['card_expired_recovery', 'chargeback_handling', 'plan_discontinued_migration', 'usage_overage_billing'],
      required_edge_cases: ['card_expired', 'chargeback', 'plan_discontinued', 'usage_overage'],
      required_a11y: ['billing_status_clear', 'charge_preview'],
      required_tradeoffs: ['immediate_upgrade_revenue_vs_user_surprise', 'grace_period_length_vs_churn_risk'],
      required_sections: [...V2_SECTIONS.slice(0, 4), 'error handling', 'implementation brief'],
    },
  },
  {
    id: 'task019',
    category: 'workflow_edge',
    workflow: 'design',
    fixture: null,
    human_eval: false,
    prompt: 'Design the product behavior for enterprise RBAC in a multi-tenant admin console: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Enterprise RBAC Admin Console

Build a **minimal vertical slice** of multi-tenant RBAC: custom roles, org/team/resource assignment, inheritance/overrides, and an audit log — without locking out the last super-admin.

## Requirements

- Create roles, assign permissions, assign users, review audit log
- Protect last super-admin; transitive inheritance; SSO group mapping stays consistent
- Resolve conflicting permissions; handle role deletion while users are assigned; tolerate SSO sync delay
- Destructive permission changes need confirmation; permission matrix must be keyboard-navigable
- Trade-off: granular permissions vs admin complexity; inheritance vs explicit override`,
    context: `## Business goals
Unblock enterprise sales by meeting SOC2-style access-control expectations.

## Users
- Org admins and security officers defining policy
- Team leads assigning roles within scope
- End users affected by role changes

## Constraints
- 50+ permission types (model a representative subset in the slice)
- Cannot lock out the last super-admin
- SSO group mapping (e.g. Okta) can lag — show and recover from sync delay`,
    golden: {
      required_entities: ['role', 'permission', 'org', 'team', 'audit_log'],
      required_invariants: ['last_super_admin_protected', 'permission_inheritance_transitive', 'sso_group_mapping_consistent'],
      required_personas: ['org_admin', 'security_officer', 'team_lead', 'end_user'],
      required_flows: ['create_role', 'assign_permissions', 'assign_user_role', 'audit_review'],
      required_rules: ['inheritance_hierarchy', 'last_admin_protection', 'sso_group_mapping'],
      required_scenarios: ['conflicting_permissions_resolution', 'role_deletion_with_active_users', 'sso_sync_delay_handling'],
      required_edge_cases: ['conflicting_permissions', 'role_deletion_with_users', 'sso_sync_delay'],
      required_a11y: ['permission_matrix_navigation', 'destructive_confirmations'],
      required_tradeoffs: ['granular_permissions_vs_admin_complexity', 'inheritance_vs_explicit_override'],
      required_sections: [...V2_SECTIONS.slice(0, 4), 'policy enforcement', 'implementation brief'],
    },
  },
  {
    id: 'task020',
    category: 'workflow_edge',
    workflow: 'design',
    fixture: null,
    human_eval: false,
    prompt: 'Design the product behavior for multi-stage employee onboarding across HR, IT, and team leads: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Multi-Stage Employee Onboarding

Build a **minimal vertical slice** coordinating HR, IT, and hiring-manager onboarding stages with dependencies, compliance gating, and a new-hire progress portal.

## Requirements

- Checklist with stage owners (HR, IT, manager); parallel where safe, sequential where required
- Compliance training gates system access; task dependencies enforced; stage ownership always clear
- Flows: kickoff, IT provisioning, team introduction, compliance training
- Handle delayed start dates, mid-onboarding role changes, and IT provisioning failure recovery
- Progress visibility and deadline reminders
- Trade-off: parallel speed vs sequential compliance; automation vs human handoff`,
    context: `## Business goals
Reduce time-to-productivity from 30 days to 14 without skipping compliance.

## Users
- New hires tracking progress
- HR coordinators owning HR stages
- IT admins provisioning access
- Hiring managers owning team integration

## Constraints
- Integrates with HRIS and identity provider (assume APIs exist)
- Compliance training required before system access
- Role changes mid-stream must recompute remaining tasks`,
    golden: {
      required_entities: ['onboarding_checklist', 'task', 'stage', 'new_hire', 'compliance_training'],
      required_invariants: ['compliance_gate_before_system_access', 'task_dependencies_enforced', 'stage_ownership_clear'],
      required_personas: ['new_hire', 'hr_coordinator', 'it_admin', 'hiring_manager'],
      required_flows: ['onboarding_kickoff', 'it_provisioning', 'team_introduction', 'compliance_training'],
      required_rules: ['task_dependencies', 'compliance_gate', 'stage_ownership'],
      required_scenarios: ['delayed_start_date_handling', 'role_change_mid_onboarding', 'it_provisioning_failure_recovery'],
      required_edge_cases: ['delayed_start', 'role_change_mid_onboarding', 'it_provisioning_failure'],
      required_a11y: ['progress_visibility', 'deadline_reminders'],
      required_tradeoffs: ['parallel_tasks_vs_sequential_compliance', 'automation_vs_human_handoff'],
      required_sections: [...V2_SECTIONS.slice(0, 4), 'recovery flows', 'implementation brief'],
    },
  },
  // Resilience & degraded states (5)
  {
    id: 'task021',
    category: 'resilience',
    workflow: 'design',
    fixture: null,
    human_eval: true,
    prompt: 'Design the product behavior for offline editing in a collaborative document editor: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Offline Editing

Build a **minimal vertical slice** of offline editing for a collaborative document editor: edit while offline, visible status, queued sync, and defined conflict resolution on reconnect.

## Requirements

- Continue editing when connectivity drops; offline/online indicator always visible
- Queue edits and sync on reconnect with no silent data loss; define conflict policy (merge vs manual)
- Flows: edit offline, view offline, reconnect sync, conflict resolution
- Handle extended offline (queue overflow), storage full, conflicting edits, and auth expiry while offline
- Status announcements for screen readers
- Trade-off: last-write-wins vs manual merge; queue size vs storage`,
    context: `## Business goals
Support low-connectivity users (field, travel, remote) without data loss or silent overwrite.

## Users
- Frequent editors working through flaky networks
- Occasional viewers who may open docs offline

## Constraints
- Assume a CRDT-based sync engine exists — design product behavior around it, do not reimplement CRDTs
- Mobile and desktop clients
- Auth can expire while offline; recovery must preserve queued work`,
    golden: {
      required_entities: ['document', 'edit_operation', 'sync_queue', 'conflict'],
      required_invariants: ['no_data_loss_on_reconnect', 'conflict_resolution_policy_defined', 'offline_indicator_always_visible'],
      required_personas: ['frequent_editor', 'occasional_viewer'],
      required_flows: ['edit_offline', 'reconnect_sync', 'conflict_resolution', 'view_offline'],
      required_rules: ['offline_indicator', 'sync_queue', 'conflict_policy'],
      required_scenarios: ['extended_offline_queue_overflow', 'conflicting_edits_merge', 'auth_expired_offline_recovery'],
      required_edge_cases: ['extended_offline', 'conflicting_edits', 'storage_full', 'auth_expired_offline'],
      required_a11y: ['status_announcements', 'offline_mode_screen_reader'],
      required_tradeoffs: ['last_write_wins_vs_manual_merge', 'queue_size_vs_storage'],
      required_sections: [...V2_SECTIONS.slice(0, 4), 'recovery paths', 'implementation brief'],
    },
  },
  {
    id: 'task022',
    category: 'resilience',
    workflow: 'design',
    fixture: null,
    human_eval: false,
    prompt: 'Design the product behavior for screen-reader support on a data-heavy analytics dashboard: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Screen Reader Analytics Dashboard

Build a **minimal vertical slice** of an analytics dashboard that is fully usable with keyboard and screen reader — not a visual-only chart wall.

## Requirements

- Navigate dashboard, explore a chart, apply filters, export data without relying on vision
- Every chart has a text alternative; status never by color alone; logical focus order and skip links
- Live regions for updates without flooding; accessible empty and loading states
- Table navigation patterns for underlying data; announce filter changes
- Trade-off: data density vs screen-reader verbosity; live updates vs cognitive load`,
    context: `## Business goals
Meet WCAG 2.1 AA for enterprise procurement while keeping the dashboard useful for sighted analysts.

## Users
- Screen-reader users analyzing trends
- Keyboard-only users
- Sighted analysts (must not regress)

## Constraints
- Scope the slice to a representative dashboard with a few chart types + one data table — not 20 chart implementations
- Real-time updates must be throttled/summarized for assistive tech
- Empty and loading states must be announced`,
    golden: {
      required_entities: ['dashboard', 'chart', 'filter', 'data_table'],
      required_invariants: ['no_color_only_status', 'text_alternative_for_every_chart', 'focus_order_logical'],
      required_personas: ['screen_reader_user', 'keyboard_user', 'sighted_analyst'],
      required_flows: ['navigate_dashboard', 'explore_chart', 'apply_filter', 'export_data'],
      required_rules: ['text_alternatives', 'no_color_only', 'focus_management'],
      required_scenarios: ['live_region_overflow_handling', 'empty_chart_accessible_state', 'loading_state_announced'],
      required_edge_cases: ['live_region_overflow', 'empty_chart', 'loading_state'],
      required_a11y: ['aria_live_regions', 'table_navigation', 'chart_descriptions', 'skip_links'],
      required_tradeoffs: ['data_density_vs_screen_reader_verbosity', 'live_updates_vs_cognitive_load'],
      required_sections: V2_SECTIONS,
    },
  },
  {
    id: 'task023',
    category: 'resilience',
    workflow: 'design',
    fixture: null,
    human_eval: true,
    prompt: 'Design the product behavior for empty states across a project management application: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Empty States Design

Build a **minimal vertical slice** of empty-state behavior for a project-management app (projects, cycles, search): first-run guidance, contextual empties, and hard distinction from errors.

## Requirements

- First-project empty with guided CTA; empty cycle; empty/zero search; error-vs-empty distinction
- When permissions block creation, explain why — do not show a dead CTA
- Handle filtered-to-zero results and "deleted all items" recovery differently from first-run empty
- Announce empty states; sensible CTA focus order
- Tone: encouraging but accurate — never claim data exists when it does not
- Trade-off: guidance vs clutter; encouraging tone vs accuracy`,
    context: `## Business goals
Improve activation for new teams by turning empty views into clear next actions.

## Users
- New users seeing first-run empties
- Experienced users hitting empty cycles/search/filters
- Admins who may lack create permission in a view

## Constraints
- Consistent illustration/copy system; localization-ready strings
- Error/failure states must never look like "nothing here yet"
- Permission-limited empties must explain the restriction`,
    golden: {
      required_entities: ['project', 'cycle', 'search_result', 'empty_state'],
      required_invariants: ['error_distinct_from_empty', 'actionable_cta_when_permissions_allow', 'permission_limited_empty_explained'],
      required_personas: ['new_user', 'experienced_user'],
      required_flows: ['first_project_empty', 'empty_search', 'empty_cycle', 'error_vs_empty'],
      required_rules: ['actionable_cta', 'error_distinction', 'tone_guidelines'],
      required_scenarios: ['permission_limited_empty_state', 'filtered_to_zero_results', 'deleted_all_items_recovery'],
      required_edge_cases: ['permission_limited_empty', 'filtered_to_zero', 'deleted_all_items'],
      required_a11y: ['empty_state_announced', 'cta_focus_order'],
      required_tradeoffs: ['guidance_vs_clutter', 'encouraging_tone_vs_accuracy'],
      required_sections: V2_SECTIONS,
    },
  },
  {
    id: 'task024',
    category: 'resilience',
    workflow: 'design',
    fixture: null,
    human_eval: false,
    prompt: 'Design the product behavior for session expiration and re-authentication: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Session Expiration UX

Build a **minimal vertical slice** of session timeout and re-authentication that preserves unsaved work and recovers mid-action failures — including SSO.

## Requirements

- Warn before idle expiry with an extend option; 30-minute idle timeout
- Preserve unsaved form work across re-auth; recover gracefully if session dies mid-submit
- Flows: idle warning, extend session, re-auth with work preservation, expired mid-submit
- Handle SSO (Okta) failure, concurrent session conflicts, and focus management on the warning modal
- Timeout warning must be announced to assistive tech
- Trade-off: security timeout vs workflow disruption; extend session vs force re-auth`,
    context: `## Business goals
Meet security compliance for idle timeout without destroying in-progress work or spiking support tickets.

## Users
- Active users in form-heavy workflows
- Idle users who stepped away

## Constraints
- 30-minute idle timeout; SSO via Okta
- Concurrent sessions may conflict — define product behavior
- Never silently discard unsaved form data on re-auth`,
    golden: {
      required_entities: ['session', 'auth_token', 'unsaved_work', 'sso_provider'],
      required_invariants: ['unsaved_work_preserved_on_reauth', 'warning_before_expiry', 'mid_action_graceful_recovery'],
      required_personas: ['active_user', 'idle_user'],
      required_flows: ['idle_warning', 'extend_session', 'reauth_preserve_work', 'expired_mid_submit'],
      required_rules: ['warning_timing', 'work_preservation', 'sso_redirect'],
      required_scenarios: ['sso_failure_recovery', 'concurrent_session_conflict', 'unsaved_form_data_preservation'],
      required_edge_cases: ['sso_failure', 'concurrent_sessions', 'unsaved_form_data'],
      required_a11y: ['timeout_warning_announced', 'focus_on_modal'],
      required_tradeoffs: ['security_timeout_vs_workflow_disruption', 'extend_session_vs_force_reauth'],
      required_sections: [...V2_SECTIONS.slice(0, 4), 'recovery paths', 'implementation brief'],
    },
  },
  {
    id: 'task025',
    category: 'resilience',
    workflow: 'design',
    fixture: null,
    human_eval: false,
    prompt: 'Design the product behavior for slow-network conditions in a media-rich web application: domain entities, illegal states, actors and permissions, workflows, edge-case scenarios, named trade-offs, and an implementation brief.',
    description: `# Slow Network Degradation

Build a **minimal vertical slice** of progressive degradation for a media-rich web app on slow or unstable networks: detection, low-bandwidth mode, queued actions, and recoverable partial loads.

## Requirements

- Detect poor connectivity (with user opt-in low-bandwidth mode); skeletons + progressive media loading
- Queue user actions idempotently; show sync/retry status; resume partial loads
- Flows: slow-load feedback, low-bandwidth mode, queued action, retry failed
- Handle connection drop mid-upload, timeouts, and partial-load resume
- Announce loading status; offer reduced-motion
- Trade-off: media quality vs load time; auto-detection vs explicit opt-in`,
    context: `## Business goals
Retain users in emerging markets and on flaky mobile networks without appearing broken.

## Users
- Mobile users on 3G/4G
- Rural and traveling users with variable connectivity

## Constraints
- Image/video-heavy content; offline-first read cache for already-fetched media
- Low-bandwidth mode must actually reduce payload
- Queued actions must be idempotent on retry`,
    golden: {
      required_entities: ['media_asset', 'sync_queue', 'bandwidth_profile', 'action'],
      required_invariants: ['queued_action_idempotent', 'bandwidth_mode_reduces_payload', 'partial_load_recoverable'],
      required_personas: ['mobile_user', 'low_bandwidth_user'],
      required_flows: ['slow_load_feedback', 'low_bandwidth_mode', 'queued_action', 'retry_failed'],
      required_rules: ['progressive_loading', 'bandwidth_detection', 'queue_policy'],
      required_scenarios: ['connection_drop_mid_upload', 'timeout_retry', 'partial_load_resume'],
      required_edge_cases: ['connection_drop_mid_upload', 'timeout', 'partial_load'],
      required_a11y: ['loading_status_announced', 'reduced_motion_option'],
      required_tradeoffs: ['media_quality_vs_load_time', 'auto_detection_vs_user_opt_in'],
      required_sections: [...V2_SECTIONS.slice(0, 4), 'user guidance', 'implementation brief'],
    },
  },
];

function toYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent);
  const lines = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === null) {
      lines.push(`${pad}${key}: null`);
    } else if (typeof val === 'boolean') {
      lines.push(`${pad}${key}: ${val}`);
    } else if (typeof val === 'number') {
      lines.push(`${pad}${key}: ${val}`);
    } else if (typeof val === 'string') {
      const needsQuote = val.includes(':') || val.includes('#');
      lines.push(`${pad}${key}: ${needsQuote ? `"${val.replace(/"/g, '\\"')}"` : val}`);
    } else if (Array.isArray(val)) {
      lines.push(`${pad}${key}:`);
      for (const item of val) {
        lines.push(`${pad}  - ${item}`);
      }
    } else if (typeof val === 'object') {
      lines.push(`${pad}${key}:`);
      lines.push(toYaml(val, indent + 1));
    }
  }
  return lines.filter(Boolean).join('\n');
}

for (const task of CORPUS) {
  const taskDir = path.join(TASKS, task.id);
  const goldenDir = path.join(GOLDENS, task.id);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(goldenDir, { recursive: true });

  fs.writeFileSync(path.join(taskDir, 'description.md'), task.description.trim() + '\n');
  fs.writeFileSync(path.join(taskDir, 'context.md'), task.context.trim() + '\n');

  const taskYaml = {
    id: task.id,
    category: task.category,
    workflow: task.workflow,
    prompt: task.prompt,
    fixture: task.fixture ?? null,
    human_eval: task.human_eval ?? false,
    runs: 3,
  };
  if (task.oss) taskYaml.oss = task.oss;
  fs.writeFileSync(path.join(taskDir, 'task.yaml'), toYaml(taskYaml) + '\n');

  const golden = { task_id: task.id, ...task.golden };
  const goldenBody = toYaml(golden).replace(
    /^task_id: .+$/m,
    (line) =>
      `${line}\n# reference_checklist: not ground truth — concepts to look for, any wording OK`,
  );
  fs.writeFileSync(path.join(goldenDir, 'golden.yaml'), goldenBody + '\n');
}

console.log(`Generated ${CORPUS.length} tasks in ${TASKS}`);
