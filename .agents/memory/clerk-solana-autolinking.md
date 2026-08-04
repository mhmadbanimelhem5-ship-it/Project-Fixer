---
name: Clerk Solana autolinking
description: Clerk's web SDK can pull unused Solana native packages into Expo Android builds.
---

When an Expo app uses Clerk but not Solana wallets, exclude Clerk's transitive Solana native packages through Expo autolinking rather than removing Clerk or manually editing generated Android files.

**Why:** `@clerk/clerk-js` depends on Solana wallet adapters, and Expo may otherwise include their Android native module in EAS/Gradle builds even when the app never imports it.

**How to apply:** Keep the Clerk Expo module autolinked, verify the configured autolinking list contains Clerk but no Solana modules, and re-run prebuild/EAS after dependency or Expo SDK changes.