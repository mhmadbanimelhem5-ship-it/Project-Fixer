---
name: Production Secrets Need Redeploy
description: Adding a secret updates the workspace environment but not the already published runtime until the app is published again.
---

# Production Secrets Need Redeploy

## Rule
After adding or changing a secret used by a published artifact, publish a new deployment before testing the production URL.

**Why:** The live deployment keeps its existing runtime configuration; the development workflow can see the new secret while the phone and public URL still run the older build.

**How to apply:** Verify the setting locally, publish the affected artifact, then check the production endpoint or user flow before declaring the fix complete.