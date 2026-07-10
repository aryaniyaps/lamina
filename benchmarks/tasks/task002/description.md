# Clinic Appointment Scheduling

Build a **minimal vertical slice** of patient-facing scheduling for a multi-specialty clinic network: book, reschedule, cancel, and join a waitlist across providers and locations.

## Requirements

- Support patients and caregivers booking for dependents; front-desk staff handle exceptions
- Enforce one booking per slot; gate booking on insurance verification status
- Flows: book, reschedule, cancel (with policy), insurance check, waitlist when no availability
- No PHI in URLs or notifications; handle timezone confusion and same-day cancellations
- Recover when insurance is denied; offer waitlist when no slots exist
- Keyboard-accessible forms with announced errors and adequate contrast
