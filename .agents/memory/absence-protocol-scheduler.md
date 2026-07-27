---
name: Absence Protocol Scheduler
description: How the absence protocol scheduler runs and why it must be single and guarded.
---

# Absence Protocol Scheduler

## Rule

The absence protocol must have exactly one scheduler that processes pending owner notifications. Use a module-level boolean flag (`schedulerRunning`) to prevent overlapping runs.

**Why:** A duplicated scheduler (e.g. one in `routes/absence.ts` and another in `lib/absenceProtocol.ts`) causes:
- duplicate owner notification emails,
- concurrent database state transitions,
- inconsistent request status.

**How to apply:**
- Delete any duplicate scheduler file/function (e.g. `startAbsenceProtocolScheduler`).
- Keep only the scheduler in `routes/absence.ts`.
- Log scheduler start, end, and any skipped ticks due to the active lock.
- Interval is 3 minutes; actual notifications are sent every 3 hours for up to 48 hours (16 notifications).
