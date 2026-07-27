---
name: Invite Token Persistence
description: Why invite tokens must live in PostgreSQL, not in-memory Maps.
---

# Invite Token Persistence

## Rule

Store invite tokens in the `invite_tokens` table via Drizzle ORM. Never use an in-memory `Map` for tokens that must outlive a server restart.

**Why:** A server restart wipes an in-memory `Map`, so pending invite links in email messages become invalid. Users cannot accept guardian or beneficiary invitations.

**How to apply:**
- Use `createToken`, `getToken`, and `updateTokenStatus` from `emailService.ts` (they are async and DB-backed).
- Add a hourly cleanup job in `routes/email.ts` that deletes rows where `expiresAt < now`.
- Keep the `invite_tokens` table schema in `lib/db/src/schema/index.ts`.
