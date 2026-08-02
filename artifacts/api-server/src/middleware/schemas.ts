import { z } from "zod";

const email = z.string().trim().toLowerCase().email().max(320);
const nonEmptyText = z.string().trim().min(1).max(500);
const token = z.string().trim().regex(/^[a-f0-9]{64}$/i);

export const ownerEmailParams = z.object({ ownerEmail: email });

export const publicKeyEmailParams = z.object({ email });

export const registerKeyBody = z.object({
  email,
  publicKeyJwk: z.record(z.unknown()).refine((value) => typeof value.kty === "string", {
    message: "publicKeyJwk.kty is required",
  }),
});

export const sealVaultBody = z.object({
  ownerEmail: email,
  beneficiaryEmail: email,
  encryptedBlob: z.string().min(1).max(25_000_000),
  benefEncryptedKey: z.string().min(1).max(20_000).optional(),
  guardianPackages: z.array(z.object({
    email,
    encryptedShare: z.string().min(1).max(100_000),
  })).max(100),
  threshold: z.number().int().min(1).max(100),
});

export const otpRequestBody = z.object({
  beneficiaryEmail: email,
  ownerName: nonEmptyText.max(200).optional(),
});

export const otpVerifyBody = z.object({
  beneficiaryEmail: email,
  otp: z.string().trim().regex(/^\d{6}$/),
});

export const guardianShareBody = z.object({
  guardianEmail: email,
  rawShareHex: z.string().trim().regex(/^[a-f0-9]+$/i).max(100_000),
});

export const emailInviteGuardianBody = z.object({
  ownerEmail: email,
  ownerName: nonEmptyText.max(200),
  guardianName: nonEmptyText.max(200),
  guardianEmail: email,
});

export const emailInviteBeneficiaryBody = z.object({
  ownerEmail: email,
  ownerName: nonEmptyText.max(200),
  beneficiaryName: nonEmptyText.max(200),
  beneficiaryEmail: email,
  relationship: z.string().trim().max(200).optional().default(""),
});

export const emailRemoveGuardianBody = z.object({
  ownerEmail: email,
  ownerName: nonEmptyText.max(200),
  guardianEmail: email,
});

export const emailRemoveBeneficiaryBody = z.object({
  ownerEmail: email,
  ownerName: nonEmptyText.max(200),
  beneficiaryEmail: email,
});

export const emergencyEmailBody = z.object({
  ownerEmail: email,
  ownerName: nonEmptyText.max(200),
  beneficiaryName: nonEmptyText.max(200),
  beneficiaryRelation: z.string().trim().max(200).optional().default(""),
  guardianEmails: z.array(email).min(1).max(100),
});

export const voteRequestBody = z.object({
  ownerEmail: email,
  ownerName: nonEmptyText.max(200),
  guardianEmails: z.array(email).min(1).max(100),
});

export const ownerNotificationBody = z.object({
  ownerEmail: email,
  ownerName: nonEmptyText.max(200),
  beneficiaryName: nonEmptyText.max(200),
  notifCount: z.number().int().min(1).max(100),
});

export const absenceBody = z.object({
  ownerEmail: email,
  beneficiaryName: z.string().trim().max(200).optional().default(""),
  ownerName: z.string().trim().max(200).optional().default(""),
});

export const ownerOnlyBody = z.object({ ownerEmail: email });

export const pushBody = z.object({
  token: z.string().trim().regex(/^(Exponent|Expo)PushToken\[[^\]]+\]$/).max(200),
  title: nonEmptyText.max(200),
  body: nonEmptyText.max(2_000),
});

export const inviteTokenParams = z.object({ token });