# Screen Reader Analytics Dashboard

Design and implement a complete analytics dashboard that is fully usable with keyboard and screen reader — not a visual-only chart wall.

## Requirements

- Navigate dashboard, explore a chart, apply filters, export data without relying on vision
- Every chart has a text alternative; status never by color alone; logical focus order and skip links
- Live regions for updates without flooding; accessible empty and loading states
- Table navigation patterns for underlying data; announce filter changes
- Trade-off: data density vs screen-reader verbosity; live updates vs cognitive load

## Deliverable

A coherent, buildable **full-product** implementation of the brief: domain model, all primary workflows end-to-end, edge/recovery paths, and a usable product surface. Do not stop at a single-screen or thin demo stub.

## Context

## Business goals
Meet WCAG 2.1 AA for enterprise procurement while keeping the dashboard useful for sighted analysts.

## Users
- Screen-reader users analyzing trends
- Keyboard-only users
- Sighted analysts (must not regress)

## Constraints
- Cover a representative dashboard with several chart types plus one data table — enough to prove the a11y model, not 20 chart implementations
- Real-time updates must be throttled/summarized for assistive tech
- Empty and loading states must be announced
