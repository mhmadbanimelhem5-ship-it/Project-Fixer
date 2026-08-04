---
name: Clerk Android SDK requirement
description: Android compile SDK compatibility constraint for the Clerk Expo dependency
---

The Clerk Android UI dependency can require Android API 36 at compile time. The app's compile SDK must meet that dependency requirement; target SDK can remain at the project's chosen runtime target unless another dependency requires otherwise.

**Why:** EAS can complete most Gradle tasks and then fail at `:app:checkReleaseAarMetadata` when compileSdk is one API level below Clerk's requirement.

**How to apply:** When Clerk is upgraded or an EAS build fails at AAR metadata checks, inspect the required compile API and update `expo-build-properties` in `app.json`; keep the generated native folder synchronized if it is committed.