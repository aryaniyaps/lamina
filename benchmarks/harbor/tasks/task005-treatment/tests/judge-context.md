# LaminaBench judge context

## Task description
Design and implement a full sustainable-habits fitness product — not a streak-counter demo: domain model, illegal states, actors and permissions, check-in/streak/accountability/pause workflows, edge cases, named trade-offs, and a buildable habit + social product surface.

## Golden reference checklist
Concepts to look for in code; identifiers, comments, logic, and tests all count.

### required_entities
- habit
- checkin
- streak
- friend_connection
- challenge
- notification_preference

### required_invariants
- no_public_leaderboard
- opt_in_social_only
- streak_forgiveness_policy

### required_personas
- beginner
- returning_athlete
- accountability_partner

### required_flows
- daily_checkin
- habit_setup
- streak_recovery
- friend_challenge
- pause_resume_habit

### required_rules
- no_public_leaderboard
- opt_in_social
- streak_forgiveness

### required_scenarios
- missed_day_recovery
- health_sync_failure
- friend_request_declined
- health_sync_failure_recovery

### required_edge_cases
- missed_day
- health_sync_failure
- friend_request_declined

### required_a11y
- motion_reduced_mode
- voiceover_labels

### required_tradeoffs
- accountability_vs_pressure
- streak_motivation_vs_forgiveness

### required_sections
- domain model and illegal states
- actors and permissions
- workflows and decision points
- edge cases and recovery
- implementation brief
