---
name: Email Retry Queue
description: How critical email sends should retry with exponential backoff and a persistent queue.
---

# Email Retry Queue

## Rule

Critical emails (especially OTP) must be sent with `sendWithRetry`. It retries up to 3 times with exponential backoff (1s, 4s, 16s) and writes pending retries to the `retry_queue` table for background reprocessing.

**Why:** A single SMTP/Resend failure should not leave the user stuck with a generated OTP and no email. Automatic retries plus a persistent queue give transient failures a chance to resolve without blocking the user forever.

**How to apply:**
- Use `sendWithRetry(type, email, data, maxAttempts)` in place of direct email send calls for OTPs.
- A background job (`processRetryQueue`) runs every 5 minutes and reprocesses pending `retry_queue` rows whose `nextRetryAt` has passed and `attempts < maxAttempts`.
- Update the row status to `completed` on success, `failed` when attempts are exhausted, or keep `pending` with an updated `nextRetryAt` on transient failure.
- Keep the `retry_queue` table schema in `lib/db/src/schema/index.ts`.
