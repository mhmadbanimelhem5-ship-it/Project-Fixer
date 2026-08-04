---
name: EAS public env propagation
description: Passing public Expo configuration from Replit into remote EAS builds
---

Remote EAS builds do not automatically inherit Replit workspace secrets. Even a public Clerk publishable key must be present in the selected EAS environment when the app reads it from `process.env` at runtime.

**Why:** A native build can finish successfully while the app crashes immediately if a required public environment variable is absent from the embedded bundle.

**How to apply:** Set the public variable in the matching EAS environment (`preview` or `production`) after authenticating with `eas login`; never put the Clerk secret key in EAS mobile build configuration.