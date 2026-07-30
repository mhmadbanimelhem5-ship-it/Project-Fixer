---
name: API Security Guards
description: Durable rules for API rate limiting and multi-instance absence scheduler coordination.
---

# API Security Guards

## Rule

The API runs behind one Replit reverse-proxy hop, so rate limiting must use `trust proxy = 1` and a general limiter before the `/api` router. The absence scheduler needs both a process-local non-waiting mutex and PostgreSQL advisory lock ID 42.

**Why:** Without proxy trust, express-rate-limit can misidentify clients and emit proxy-header validation errors. A boolean or in-process mutex alone cannot prevent duplicate scheduler work across server instances.

**How to apply:**
- Keep general API limits mounted before route handlers.
- Use stricter, failed-attempt-only limits on OTP and invitation endpoints.
- Use `tryAcquire` so overlapping local ticks skip immediately.
- Acquire and release the same PostgreSQL advisory lock around the scheduler work, and keep only one scheduler definition.