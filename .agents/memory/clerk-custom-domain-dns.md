---
name: Clerk custom-domain DNS
description: Troubleshooting external Clerk keys whose encoded frontend host is a custom domain.
---

When an external Clerk publishable key is tied to a custom frontend domain, the Expo SDK can load Clerk JS from that domain even when the app code is correct. If the domain has no DNS resolution, the mobile app fails before sign-in. A Replit-hosted proxy is not a safe substitute unless the custom domain is registered and accepted by the Clerk instance; otherwise Clerk returns `host_invalid`.

**Why:** The publishable key selects the Clerk frontend host; changing React code or API auth cannot repair a missing DNS record.

**How to apply:** Keep development proxy settings off unless the Clerk instance explicitly supports that proxy. Either configure the custom domain/DNS using the external Clerk provider's required records, or replace the external setup with Replit-managed Clerk keys and restart the app.