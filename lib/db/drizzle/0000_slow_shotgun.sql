CREATE TABLE "absence_guardian_decisions" (
	"request_id" integer NOT NULL,
	"guardian_email" text NOT NULL,
	"vote_token" text NOT NULL,
	"decision" text,
	"decided_at" bigint,
	CONSTRAINT "absence_guardian_decisions_request_id_guardian_email_pk" PRIMARY KEY("request_id","guardian_email")
);
--> statement-breakpoint
CREATE TABLE "absence_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_email" text NOT NULL,
	"beneficiary_email" text NOT NULL,
	"beneficiary_name" text DEFAULT '' NOT NULL,
	"owner_name" text DEFAULT '' NOT NULL,
	"requested_at" bigint NOT NULL,
	"status" text DEFAULT 'pending_owner' NOT NULL,
	"owner_last_notified_at" bigint,
	"owner_notif_count" integer DEFAULT 0 NOT NULL,
	"owner_alive_token" text,
	"guardian_vote_started_at" bigint,
	"completed_at" bigint
);
--> statement-breakpoint
CREATE TABLE "guardian_packages" (
	"owner_email" text NOT NULL,
	"guardian_email" text NOT NULL,
	"encrypted_share" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardian_votes" (
	"owner_email" text NOT NULL,
	"guardian_email" text NOT NULL,
	"encrypted_share_for_beneficiary" text NOT NULL,
	CONSTRAINT "guardian_votes_owner_email_guardian_email_pk" PRIMARY KEY("owner_email","guardian_email")
);
--> statement-breakpoint
CREATE TABLE "invite_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"email" text NOT NULL,
	"owner_name" text NOT NULL,
	"data" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "otps" (
	"owner_email" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"beneficiary_email" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_attempt_at" bigint
);
--> statement-breakpoint
CREATE TABLE "public_keys" (
	"email" text PRIMARY KEY NOT NULL,
	"jwk" jsonb NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retry_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"recipient_email" text NOT NULL,
	"data" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_attempt_at" bigint,
	"next_retry_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sealed_vaults" (
	"owner_email" text PRIMARY KEY NOT NULL,
	"beneficiary_email" text NOT NULL,
	"encrypted_blob" text NOT NULL,
	"benef_encrypted_key" text,
	"threshold" integer NOT NULL,
	"sealed_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"provider_token" text,
	"current_period_end" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "subscriptions_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"email" text PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'landing-page' NOT NULL,
	"privacy_accepted" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"confirmed_at" bigint,
	"confirmation_rank" integer,
	"discount_percent" integer DEFAULT 0 NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlist_verifications" (
	"token" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint
);
--> statement-breakpoint
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");