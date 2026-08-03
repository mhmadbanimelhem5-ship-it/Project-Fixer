---
name: Launch waitlist and subscriptions
description: Product decision separating verified launch eligibility from the later in-app payment integration.
---

The Auryx launch flow must verify the same email before granting the first-500, 50%-lifetime offer. Real subscription purchases remain an intentionally separate phase until Apple Developer, Google Play Developer, and RevenueCat are ready.

**Why:** Store products and in-app pricing cannot be tested or shipped reliably before the platform accounts and RevenueCat configuration exist; eligibility can still be built and validated independently.

**How to apply:** Keep the waitlist/API eligibility flow authoritative for who qualifies, and source actual subscription products and prices from the store/RevenueCat layer rather than hardcoding payment behavior into the landing page.