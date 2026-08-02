import { pgTable, text, jsonb, integer, bigint, primaryKey, serial, boolean } from "drizzle-orm/pg-core";

// ── RSA public keys ───────────────────────────────────────────────────────────
export const publicKeysTable = pgTable("public_keys", {
  email:     text("email").primaryKey(),
  jwk:       jsonb("jwk").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// ── Sealed vault packages ─────────────────────────────────────────────────────
export const sealedVaultsTable = pgTable("sealed_vaults", {
  ownerEmail:        text("owner_email").primaryKey(),
  beneficiaryEmail:  text("beneficiary_email").notNull(),
  encryptedBlob:     text("encrypted_blob").notNull(),
  benefEncryptedKey: text("benef_encrypted_key"),
  threshold:         integer("threshold").notNull(),
  sealedAt:          bigint("sealed_at", { mode: "number" }).notNull(),
});

// ── Guardian packages (one row per guardian per sealed vault) ─────────────────
// No composite PK — deleted and re-inserted atomically on each vault re-seal.
export const guardianPackagesTable = pgTable("guardian_packages", {
  ownerEmail:     text("owner_email").notNull(),
  guardianEmail:  text("guardian_email").notNull(),
  encryptedShare: text("encrypted_share").notNull(),
});

// ── Guardian votes (submitted Shamir shares) ──────────────────────────────────
// Composite PK enables upsert so a guardian can re-submit without duplicates.
export const guardianVotesTable = pgTable(
  "guardian_votes",
  {
    ownerEmail:    text("owner_email").notNull(),
    guardianEmail: text("guardian_email").notNull(),
    rawShareHex:   text("raw_share_hex").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerEmail, t.guardianEmail] })],
);

// ── Absence protocol requests ─────────────────────────────────────────────────
// One row per beneficiary unlock request. The scheduler drives state transitions.
export const absenceRequestsTable = pgTable("absence_requests", {
  id:                    serial("id").primaryKey(),
  ownerEmail:            text("owner_email").notNull(),
  beneficiaryEmail:      text("beneficiary_email").notNull(),
  beneficiaryName:       text("beneficiary_name").notNull().default(''),
  ownerName:             text("owner_name").notNull().default(''),
  requestedAt:           bigint("requested_at",            { mode: "number" }).notNull(),
  status:                text("status").notNull().default('pending_owner'),
  //  pending_owner | pending_beneficiary_confirmation | cancelled_by_owner
  //  | pending_guardian_vote | guardian_approved | guardian_rejected | expired
  ownerLastNotifiedAt:   bigint("owner_last_notified_at",   { mode: "number" }),
  ownerNotifCount:       integer("owner_notif_count").notNull().default(0),
  ownerAliveToken:       text("owner_alive_token"),
  guardianVoteStartedAt: bigint("guardian_vote_started_at", { mode: "number" }),
  completedAt:           bigint("completed_at",             { mode: "number" }),
});

// ── Absence guardian decisions ─────────────────────────────────────────────────
// Per-guardian approve/reject votes — separate from guardian_votes (Shamir shares).
export const absenceGuardianDecisionsTable = pgTable(
  "absence_guardian_decisions",
  {
    requestId:    integer("request_id").notNull(),
    guardianEmail: text("guardian_email").notNull(),
    voteToken:    text("vote_token").notNull(),
    decision:     text("decision"),        // 'approve' | 'reject' | null
    decidedAt:    bigint("decided_at", { mode: "number" }),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.guardianEmail] })],
);

// ── Invite tokens (guardian / beneficiary invites) ────────────────────────────
export const inviteTokensTable = pgTable("invite_tokens", {
  token:     text("token").primaryKey(),
  type:      text("type").notNull(),           // 'guardian-invite' | 'beneficiary-invite'
  email:     text("email").notNull(),
  ownerName: text("owner_name").notNull(),
  data:      jsonb("data").notNull(),          // extra metadata (e.g. guardianName, relationship)
  status:    text("status").notNull().default('pending'), // 'pending' | 'accepted' | 'rejected'
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdBy: text("created_by"),
});

// ── Retry queue for failed emails ─────────────────────────────────────────────
export const retryQueueTable = pgTable("retry_queue", {
  id:             serial("id").primaryKey(),
  type:           text("type").notNull(),               // 'otp-email', 'guardian-invite', etc.
  recipientEmail: text("recipient_email").notNull(),
  data:           jsonb("data").notNull(),             // payload passed to the send function
  attempts:       integer("attempts").notNull().default(0),
  maxAttempts:    integer("max_attempts").notNull().default(3),
  lastAttemptAt:  bigint("last_attempt_at", { mode: "number" }),
  nextRetryAt:    bigint("next_retry_at", { mode: "number" }).notNull(),
  createdAt:      bigint("created_at", { mode: "number" }).notNull(),
  status:         text("status").notNull().default('pending'), // 'pending' | 'completed' | 'failed'
});

// ── OTP store ─────────────────────────────────────────────────────────────────
export const otpsTable = pgTable("otps", {
  ownerEmail:       text("owner_email").primaryKey(),
  code:             text("code").notNull(),
  beneficiaryEmail: text("beneficiary_email").notNull(),
  createdAt:        bigint("created_at", { mode: "number" }).notNull(),
  expiresAt:        bigint("expires_at", { mode: "number" }).notNull(),
  usedAt:           bigint("used_at",    { mode: "number" }),
});

// ── Auryx launch waitlist ─────────────────────────────────────────────────────
// Confirmation rank is assigned under a PostgreSQL advisory lock so exactly
// the first 500 confirmed addresses receive the lifetime launch discount.
export const waitlistEntriesTable = pgTable("waitlist_entries", {
  email:             text("email").primaryKey(),
  source:            text("source").notNull().default("landing-page"),
  privacyAccepted:   boolean("privacy_accepted").notNull().default(false),
  createdAt:         bigint("created_at", { mode: "number" }).notNull(),
  confirmedAt:       bigint("confirmed_at", { mode: "number" }),
  confirmationRank:  integer("confirmation_rank"),
  discountPercent:   integer("discount_percent").notNull().default(0),
  updatedAt:         bigint("updated_at", { mode: "number" }).notNull(),
});

export const waitlistVerificationsTable = pgTable("waitlist_verifications", {
  token:      text("token").primaryKey(),
  email:      text("email").notNull(),
  createdAt:  bigint("created_at", { mode: "number" }).notNull(),
  expiresAt:  bigint("expires_at", { mode: "number" }).notNull(),
  usedAt:     bigint("used_at", { mode: "number" }),
});
