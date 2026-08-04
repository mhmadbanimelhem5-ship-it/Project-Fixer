import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    "req.body.otp",
    "req.body.encryptedShareForBeneficiary",
    "req.body.encryptedBlob",
    "req.body.benefEncryptedKey",
    "req.body.publicKeyJwk",
    "req.body.token",
    "req.body.guardianPackages",
    "req.body.ownerEmail",
    "req.body.beneficiaryEmail",
    "req.body.guardianEmail",
    "req.body.email",
    "req.params.token",
    "token",
    "otp",
    "email",
    "to",
    "ownerEmail",
    "beneficiaryEmail",
    "guardianEmail",
    "recipientEmail",
    "smtpUser",
    "encryptedShareForBeneficiary",
    "encryptedBlob",
    "benefEncryptedKey",
    "publicKeyJwk",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
