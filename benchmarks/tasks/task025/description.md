# Slow Network Degradation

Design and implement complete progressive degradation for a media-rich web app on slow or unstable networks: detection, low-bandwidth mode, queued actions, and recoverable partial loads.

## Requirements

- Detect poor connectivity (with user opt-in low-bandwidth mode); skeletons + progressive media loading
- Queue user actions idempotently; show sync/retry status; resume partial loads
- Flows: slow-load feedback, low-bandwidth mode, queued action, retry failed
- Handle connection drop mid-upload, timeouts, and partial-load resume
- Announce loading status; offer reduced-motion
- Trade-off: media quality vs load time; auto-detection vs explicit opt-in

## Deliverable

A coherent, buildable **full-product** implementation of the brief: domain model, all primary workflows end-to-end, edge/recovery paths, and a usable product surface. Do not stop at a single-screen or thin demo stub.
