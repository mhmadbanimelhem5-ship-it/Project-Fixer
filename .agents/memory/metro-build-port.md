---
name: Metro build port selection
description: Static Expo builds must not assume Metro port 8081 when other workspace workflows are running.
---

The Auryx static build should probe for an available local Metro port and use that same port for bundling, manifests, and asset processing.

**Why:** Replit can run another workflow on port 8081; Expo then prompts for a replacement port, and the non-interactive build fails instead of continuing.

**How to apply:** Keep port selection inside the build script. Do not stop unrelated workflows just to make an Auryx build pass.