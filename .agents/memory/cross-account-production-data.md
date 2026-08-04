---
name: Cross-account production data
description: Data continuity when the same product is published from separate Replit accounts or deployments
---

Publishing a project from a different Replit account or project can point the deployment at a separate production database. An empty table in the new deployment does not prove that records were deleted from the old deployment.

**Why:** Replit production databases are isolated per app/deployment environment, and public app URLs can continue serving data from the older environment.

**How to apply:** Keep the old deployment running until the canonical deployment is chosen, records are exported or re-confirmed safely, the new database is verified, and all landing/app links are switched. Never stop the old deployment as the first step.