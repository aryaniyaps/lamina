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
  'domain and invariants',
  'actors and permissions',
  'workflows',
  'scenarios',
  'implement brief',
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
    prompt: 'Design the core UX for a household budgeting app.',
    description: `# Household Budgeting App

Design a new mobile-first budgeting product for young families in the US.

## Requirements

- Help users understand where money goes across multiple accounts
- Reduce financial anxiety through clarity, not judgment
- Support weekly check-ins without overwhelming daily tracking
- Exclude investment advice and tax filing`,
    context: `## Business goals
Launch a budgeting app achieving 40% weekly active usage within 90 days.

## Users
Young families (25–40) with dual incomes, 1–2 children, managing 2–4 financial accounts.

## Constraints
- Mobile-first (iOS and Android)
- US market only
- No investment or tax advice
- Must work offline for viewing balances`,
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
    prompt: 'Design the appointment scheduling experience for a multi-provider clinic.',
    description: `# Clinic Appointment Scheduling

Design a patient-facing scheduling system for a multi-specialty clinic network.

## Requirements

- Patients book, reschedule, and cancel appointments online
- Support multiple providers, locations, and appointment types
- Handle insurance verification status in the flow
- Reduce phone call volume to front desk`,
    context: `## Business goals
Reduce call center scheduling volume by 50% within 6 months.

## Users
Patients (18+), caregivers booking for dependents, front-desk staff handling exceptions.

## Constraints
- HIPAA-aware UX (no PHI in URLs or notifications)
- Integrates with existing EHR scheduling backend
- English and Spanish at launch`,
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
    prompt: 'Design a volunteer management platform for nonprofit coordinators.',
    description: `# Volunteer Management Platform

Design a platform for nonprofit coordinators to recruit, schedule, and communicate with volunteers.

## Requirements

- Coordinators post opportunities and manage shifts
- Volunteers discover, sign up, and track hours
- Handle background check status and certifications
- Mobile-friendly for volunteers on-site`,
    context: `## Business goals
Increase volunteer retention by 30% and reduce coordinator admin time.

## Users
Nonprofit coordinators, volunteers (ages 16–70), organization admins.

## Constraints
- Background check integration (third-party API)
- SMS notifications for shift reminders
- Free tier for small nonprofits`,
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
    prompt: 'Design a collaborative travel itinerary planner for friend groups.',
    description: `# Travel Itinerary Planner

Design a collaborative trip planning tool for friend groups organizing vacations together.

## Requirements

- Shared itinerary with flights, lodging, activities
- Expense splitting and settlement tracking
- Voting on activities and restaurants
- Offline access during travel`,
    context: `## Business goals
Achieve 100K trip plans in year one; 25% convert to premium.

## Users
Trip organizers (25–45), group members contributing ideas, passive viewers.

## Constraints
- iOS and Android native apps
- Integrates with Google Maps and calendar
- Premium: unlimited trips and expense export`,
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
    prompt: 'Design a personal fitness tracker focused on habit formation, not metrics obsession.',
    description: `# Habit-Focused Fitness Tracker

Design a fitness app that prioritizes sustainable habits over competitive metrics.

## Requirements

- Daily habit check-ins (movement, hydration, sleep)
- Gentle streaks without punitive loss mechanics
- Optional social accountability with close friends only
- Integrates with Apple Health / Google Fit`,
    context: `## Business goals
60-day retention above 40%; differentiate from metric-heavy competitors.

## Users
Health-conscious adults (25–55) intimidated by gym culture; beginners returning to fitness.

## Constraints
- No public leaderboards
- No weight-focused default dashboards
- Privacy-first social features`,
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
    oss: { repo: 'makeplane/plane', commit: 'develop' },
    prompt: 'Design a recurring tasks feature for Plane.',
    description: `# Recurring Tasks for Plane

Design a recurring task feature that integrates with Plane's existing issue workflow.

## Requirements

- Create issues that repeat on a schedule (daily, weekly, monthly, custom)
- Handle completion vs skip for individual occurrences
- Show recurrence clearly in issue list and detail views
- Respect existing labels, assignees, and project structure`,
    context: `Plane is an open-source project management tool. See product-context.md in the workspace.

Core UX: left sidebar navigation, issue states, cycles, modules, Kanban/List views.`,
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
      required_sections: [...V2_SECTIONS.slice(0, 4), 'tradeoffs and decisions', 'implement brief'],
    },
  },
  {
    id: 'task007',
    category: 'oss_feature',
    workflow: 'design',
    fixture: 'commerce-with-init',
    human_eval: true,
    oss: { repo: 'vercel/commerce', commit: 'main' },
    prompt: 'Add a wishlist feature to the storefront.',
    description: `# Wishlist Feature

Design a wishlist feature for the Vercel Commerce storefront.

## Requirements

- Save products while browsing (authenticated and guest)
- Merge guest wishlist on login
- Share wishlist via link (optional privacy)
- Add wishlist items to cart individually or in bulk`,
    context: `Vercel Commerce is a Next.js headless storefront. Users browse products, add to cart, checkout.

Existing flows: product listing, product detail, cart, checkout.`,
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
    oss: { repo: 'outline/outline', commit: 'main' },
    prompt: 'Design guest sharing for Outline documents.',
    description: `# Guest Document Sharing

Design a guest sharing feature for Outline documents.

## Requirements

- Share a document with external users via link or email invite
- Guest can view or comment (configurable)
- Expiring links and access revocation
- Clear indication of guest vs member permissions`,
    context: `Outline is a team knowledge base with collections, real-time editing, and permissions.

Existing: collection-level permissions, @mentions, inline comments.`,
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
      required_sections: [...V2_SECTIONS.slice(0, 4), 'tradeoffs and decisions', 'implement brief'],
    },
  },
  {
    id: 'task009',
    category: 'oss_feature',
    workflow: 'design',
    fixture: 'commerce-with-init',
    human_eval: false,
    oss: { repo: 'vercel/commerce', commit: 'main' },
    prompt: 'Design saved searches for the product catalog.',
    description: `# Saved Searches

Design saved search functionality for the commerce product catalog.

## Requirements

- Save filter combinations (category, price, attributes)
- Name and manage saved searches
- Optional notifications when new products match
- Accessible from account settings and search bar`,
    context: `Vercel Commerce storefront with product search, filters, and collections.`,
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
    oss: { repo: 'makeplane/plane', commit: 'develop' },
    prompt: 'Design bulk actions for issues in Plane.',
    description: `# Bulk Issue Actions

Design bulk action UX for managing multiple issues at once in Plane.

## Requirements

- Select multiple issues across list and board views
- Bulk change state, assignee, labels, cycle, module
- Confirmation for destructive actions
- Clear feedback on partial failures`,
    context: `Plane issue management with List, Kanban, and Calendar views.`,
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
    oss: { repo: 'vercel/commerce', commit: 'main' },
    prompt: 'Audit the checkout flow for product-behavior and usability issues.',
    description: `# Checkout Flow Audit

Perform a behavior and UX audit of the storefront checkout flow.

## Scope

- Cart review through order confirmation
- Guest and authenticated checkout paths
- Payment and shipping information entry
- Error states, invariant violations, and recovery`,
    context: `Vercel Commerce Next.js storefront. Checkout includes cart, shipping, payment, confirmation.

Review the codebase and existing flows inventory in .lamina/ if present.`,
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
    fixture: 'plane-with-init',
    human_eval: true,
    oss: { repo: 'makeplane/plane', commit: 'develop' },
    prompt: 'Audit the project settings and configuration experience in Plane.',
    description: `# Project Settings Audit

Audit the product behavior and UX of project settings and configuration in Plane.

## Scope

- Project creation and configuration
- Member management and roles
- Project views and workflow states
- Integration settings and permission integrity`,
    context: `Plane project management. Focus on settings flows that team leads and admins use.`,
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
    fixture: 'outline-with-init',
    human_eval: false,
    oss: { repo: 'outline/outline', commit: 'main' },
    prompt: 'Audit document sharing and permissions behavior in Outline.',
    description: `# Document Sharing Audit

Audit how Outline handles document sharing, permissions, and invariant enforcement.

## Scope

- Share dialog and permission levels
- Collection vs document permissions
- Public link sharing
- Permission inheritance and conflicts`,
    context: `Outline knowledge base with collections, documents, and granular permissions.`,
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
    oss: { repo: 'vercel/commerce', commit: 'main' },
    prompt: 'Audit the cart experience for behavioral friction and abandonment risks.',
    description: `# Cart Experience Audit

Audit the shopping cart for behavioral friction, state consistency, and abandonment risks.

## Scope

- Add to cart feedback
- Cart modal and cart page
- Quantity changes and item removal
- Price updates and out-of-stock handling`,
    context: `Vercel Commerce storefront cart implementation.`,
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
    fixture: 'plane-with-init',
    human_eval: false,
    oss: { repo: 'makeplane/plane', commit: 'develop' },
    prompt: 'Audit the new user onboarding experience in Plane.',
    description: `# Onboarding Audit

Audit Plane's onboarding flow for behavioral gaps and time-to-value issues.

## Scope

- Workspace creation
- First project setup
- Invite teammates
- Initial issue creation`,
    context: `Plane onboarding for new teams getting started with project management.`,
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
    prompt: 'Design a healthcare appointment scheduling workflow with complex insurance rules.',
    description: `# Healthcare Scheduling with Insurance Rules

Design scheduling UX for a clinic where insurance verification affects appointment availability.

## Requirements

- Real-time insurance eligibility check before booking
- Different flows for in-network vs out-of-network
- Handle prior authorization requirements
- Clear communication when insurance blocks booking`,
    context: `## Business goals
Reduce no-shows caused by insurance surprises; comply with healthcare regulations.

## Users
Patients, scheduling staff, insurance coordinators.

## Constraints
- Cannot guarantee coverage — display disclaimers
- Prior auth may take 24–72 hours`,
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
      required_sections: [...V2_SECTIONS.slice(0, 4), 'policy enforcement', 'implement brief'],
    },
  },
  {
    id: 'task017',
    category: 'workflow_edge',
    workflow: 'design',
    fixture: null,
    human_eval: true,
    prompt: 'Design an expense reimbursement approval workflow for a mid-size company.',
    description: `# Expense Reimbursement Workflow

Design a multi-step expense reimbursement system with manager and finance approval.

## Requirements

- Submit expenses with receipts and categories
- Manager approval → finance review → payment
- Handle policy violations and partial approvals
- Audit trail for compliance`,
    context: `## Business goals
Reduce reimbursement processing time from 14 days to 5 days.

## Users
Employees, managers, finance team, auditors.

## Constraints
- Policy limits by category and role
- Receipt required above $25
- Multi-currency for travel`,
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
      required_sections: [...V2_SECTIONS.slice(0, 4), 'state management', 'implement brief'],
    },
  },
  {
    id: 'task018',
    category: 'workflow_edge',
    workflow: 'design',
    fixture: null,
    human_eval: false,
    prompt: 'Design subscription billing UX with upgrades, downgrades, and proration.',
    description: `# Subscription Billing Workflow

Design billing UX for a SaaS product with plan changes mid-cycle.

## Requirements

- Upgrade immediately with prorated charge
- Downgrade at end of billing period
- Handle failed payments and grace periods
- Clear invoice history and upcoming charges`,
    context: `## Business goals
Reduce billing support tickets by 40%.

## Users
Account owners, team admins, finance contacts.

## Constraints
- Stripe integration
- Monthly and annual plans
- Usage-based add-ons`,
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
      required_sections: [...V2_SECTIONS.slice(0, 4), 'error handling', 'implement brief'],
    },
  },
  {
    id: 'task019',
    category: 'workflow_edge',
    workflow: 'design',
    fixture: null,
    human_eval: false,
    prompt: 'Design enterprise RBAC permission management for a multi-tenant admin console.',
    description: `# Enterprise RBAC Admin Console

Design role-based access control management for enterprise admins.

## Requirements

- Define custom roles with granular permissions
- Assign roles at org, team, and resource levels
- Permission inheritance and override rules
- Audit log of permission changes`,
    context: `## Business goals
Enable enterprise sales by meeting SOC2 access control requirements.

## Users
Org admins, security officers, team leads, end users.

## Constraints
- 50+ permission types
- Cannot lock out last super-admin
- SSO group mapping`,
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
      required_sections: [...V2_SECTIONS.slice(0, 4), 'policy enforcement', 'implement brief'],
    },
  },
  {
    id: 'task020',
    category: 'workflow_edge',
    workflow: 'design',
    fixture: null,
    human_eval: false,
    prompt: 'Design a multi-stage employee onboarding workflow across HR, IT, and team leads.',
    description: `# Multi-Stage Employee Onboarding

Design onboarding coordination across HR, IT provisioning, and team integration.

## Requirements

- Onboarding checklist with stage owners (HR, IT, manager)
- Parallel and sequential task dependencies
- New hire portal showing progress
- Handle delayed start dates and role changes`,
    context: `## Business goals
Reduce time-to-productivity from 30 days to 14 days.

## Users
New hires, HR coordinators, IT admins, hiring managers.

## Constraints
- Integrates with HRIS and identity provider
- Compliance training required before system access`,
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
      required_sections: [...V2_SECTIONS.slice(0, 4), 'recovery flows', 'implement brief'],
    },
  },
  // Resilience & degraded states (5)
  {
    id: 'task021',
    category: 'resilience',
    workflow: 'design',
    fixture: null,
    human_eval: true,
    prompt: 'Design offline editing UX for a collaborative document editor.',
    description: `# Offline Editing

Design how a collaborative document editor handles offline editing and reconnection.

## Requirements

- Continue editing when connection drops
- Clear offline/online status indicator
- Conflict resolution when multiple users edited offline
- Queue changes and sync on reconnect`,
    context: `## Business goals
Support users in low-connectivity environments without data loss.

## Users
Remote workers, field staff, travelers.

## Constraints
- CRDT-based sync engine (assume exists)
- Mobile and desktop clients`,
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
      required_sections: [...V2_SECTIONS.slice(0, 4), 'recovery paths', 'implement brief'],
    },
  },
  {
    id: 'task022',
    category: 'resilience',
    workflow: 'design',
    fixture: null,
    human_eval: false,
    prompt: 'Design screen reader support for a data-heavy analytics dashboard.',
    description: `# Screen Reader Analytics Dashboard

Design accessible UX for a data analytics dashboard used with screen readers.

## Requirements

- Navigate charts and tables non-visually
- Summarize data trends in text alternatives
- Filter and drill-down via keyboard and screen reader
- Do not rely on color alone for status indicators`,
    context: `## Business goals
Meet WCAG 2.1 AA for enterprise procurement.

## Users
Analysts with visual impairments, keyboard-only users, sighted analysts.

## Constraints
- 20+ chart types
- Real-time data updates`,
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
    prompt: 'Design empty states across a project management application.',
    description: `# Empty States Design

Design comprehensive empty states for a project management application.

## Requirements

- First-time user empty states with guided actions
- Contextual empty states (empty project, empty cycle, no search results)
- Distinguish "nothing here yet" from "failed to load"
- Accessible and encouraging tone`,
    context: `## Business goals
Improve activation rate for new teams.

## Users
New users, experienced users encountering empty views, admins.

## Constraints
- Consistent illustration system
- Localization support`,
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
    prompt: 'Design session expiration and re-authentication UX.',
    description: `# Session Expiration UX

Design how the application handles session timeout and re-authentication.

## Requirements

- Warn before session expires with extend option
- Preserve unsaved work during re-auth
- Handle expired session mid-action gracefully
- Support SSO re-authentication`,
    context: `## Business goals
Balance security compliance with minimal workflow disruption.

## Users
All authenticated users; especially form-heavy workflows.

## Constraints
- 30-minute idle timeout
- SSO with Okta`,
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
      required_sections: [...V2_SECTIONS.slice(0, 4), 'recovery paths', 'implement brief'],
    },
  },
  {
    id: 'task025',
    category: 'resilience',
    workflow: 'design',
    fixture: null,
    human_eval: false,
    prompt: 'Design UX for slow network conditions in a media-rich web application.',
    description: `# Slow Network Degradation

Design progressive degradation for a media-rich web app on slow networks.

## Requirements

- Detect connection quality and adapt UI
- Skeleton screens and progressive image loading
- Allow low-bandwidth mode opt-in
- Queue actions and show sync status`,
    context: `## Business goals
Retain users in emerging markets with variable connectivity.

## Users
Mobile users on 3G/4G, rural users, international travelers.

## Constraints
- Image and video heavy content
- Offline-first read cache`,
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
      required_sections: [...V2_SECTIONS.slice(0, 4), 'user guidance', 'implement brief'],
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
  fs.writeFileSync(path.join(goldenDir, 'golden.yaml'), toYaml(golden) + '\n');
}

console.log(`Generated ${CORPUS.length} tasks in ${TASKS}`);
