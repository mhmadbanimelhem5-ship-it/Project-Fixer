---
name: API Security Guards
description: Durable API security rules for proxy rate limits, scheduler coordination, and Vercel webhook signatures.
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

## Vercel webhook signatures

For HMAC webhooks hosted as Vercel Functions, disable Vercel's automatic body parser at the function entry point, then use route-scoped `express.raw()` before the general `express.json()` middleware. The signature must be checked against the original request bytes; never log the raw payload because it may contain user data.

**Why:** Vercel's parser can consume or transform the request before Express middleware sees it, invalidating an HMAC over the original body. Logging the full body can expose personal or subscription data.

**How to apply:**
- Set the function's `api.bodyParser` configuration to `false`.
- Install `express.raw()` only on the webhook path, before `express.json()`.
- Compute the provider's HMAC from the exact raw bytes and its documented timestamp format.
- Log only safe diagnostics such as content length and whether required fields are present.