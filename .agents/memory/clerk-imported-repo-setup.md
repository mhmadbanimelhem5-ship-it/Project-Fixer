---
name: Clerk setup after importing a repository
description: Imported Auryx repositories may contain Clerk wiring but no provisioned Replit-managed Clerk keys in the new workspace.
---

When importing an Expo app that already references Clerk, verify the workspace has Clerk configured before debugging the mobile bundle. If the app throws a missing publishable-key error and Clerk is not configured, provision the managed Clerk setup and restart both Expo and the API.

**Why:** The source repository can include the integration code without carrying the environment-managed keys into the new Replit workspace.

**How to apply:** Check Clerk management status and secret existence first; never hardcode or print the publishable or secret key.