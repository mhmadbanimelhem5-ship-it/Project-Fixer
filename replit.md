# Auryx

Auryx is a secure digital vault mobile app. It lets owners seal encrypted vaults, appoint guardians and beneficiaries, and trigger an absence protocol that transfers access through guardian voting and OTP verification.

## Run & Operate

- `pnpm --filter @workspace/auryx run dev` — run the Expo mobile app
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run typecheck:libs` — rebuild composite lib declarations
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional email env: `RESEND_API_KEY` or `SMTP_USER` + `SMTP_PASS`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Mobile: Expo (React Native) with Expo Router
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod, `drizzle-zod`
- Build: esbuild (CJS bundle)

## Where things live

- DB schema: `lib/db/src/schema/index.ts`
- API routes: `artifacts/api-server/src/routes/`
- Email logic: `artifacts/api-server/src/lib/emailService.ts`
- Absence protocol: `artifacts/api-server/src/routes/absence.ts` + `artifacts/api-server/src/lib/absenceStore.ts`
- Vault transfer: `artifacts/api-server/src/routes/vaultTransfer.ts`
- Mobile app: `artifacts/auryx/`

## Architecture decisions

- All scheduler state lives in PostgreSQL so it survives restarts.
- Invite tokens and email retry queue are stored in the DB, not in-memory.
- A single absence scheduler runs with a module-level concurrency lock to prevent duplicate notifications.
- Email sends (especially OTP) use in-request exponential backoff plus a persistent retry queue.

## Product

- Owners seal encrypted vaults and choose guardians + beneficiaries.
- Emergency absence protocol notifies the owner every 3 hours for 48 hours, then lets the beneficiary start a guardian vote.
- Once enough guardians approve, an OTP is sent to the beneficiary to unlock the vault.
- Guardians and beneficiaries accept their roles via email invite links.

## User preferences

_(none yet)_

## Gotchas

- Run `pnpm run typecheck:libs` before `pnpm --filter @workspace/api-server run typecheck` when changing `lib/db` schema.
- The API server needs `RESEND_API_KEY` or `SMTP_USER`/`SMTP_PASS` to send real emails.
- Do not run `npx expo start` directly; use the managed `artifacts/auryx: expo` workflow.

## Pointers

- See the `pnpm-workspace` skill for workspace structure and TypeScript setup.
- See the `expo` skill for mobile app guidelines.
