# Multi-Stage Employee Onboarding

Design and implement a complete employee onboarding coordination product spanning HR, IT, and hiring-manager stages with dependencies, compliance gating, and a new-hire progress portal.

## Requirements

- Checklist with stage owners (HR, IT, manager); parallel where safe, sequential where required
- Compliance training gates system access; task dependencies enforced; stage ownership always clear
- Flows: kickoff, IT provisioning, team introduction, compliance training
- Handle delayed start dates, mid-onboarding role changes, and IT provisioning failure recovery
- Progress visibility and deadline reminders
- Trade-off: parallel speed vs sequential compliance; automation vs human handoff

## Deliverable

A coherent, buildable **full-product** implementation of the brief: domain model, all primary workflows end-to-end, edge/recovery paths, and a usable product surface. Do not stop at a single-screen or thin demo stub.

## Context

## Business goals
Reduce time-to-productivity from 30 days to 14 without skipping compliance.

## Users
- New hires tracking progress
- HR coordinators owning HR stages
- IT admins provisioning access
- Hiring managers owning team integration

## Constraints
- Integrates with HRIS and identity provider (assume APIs exist)
- Compliance training required before system access
- Role changes mid-stream must recompute remaining tasks
