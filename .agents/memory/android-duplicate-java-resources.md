---
name: Android duplicate Java resources
description: Gradle release build failures caused by identical META-INF files from Java dependencies
---

Android release builds can fail during `mergeReleaseJavaResource` when two dependencies contain the same `META-INF` path. This is packaging metadata, not an application-code error.

**Why:** Gradle refuses to choose between identical resource paths from different JARs unless the packaging policy explicitly resolves the conflict.

**How to apply:** Add the exact duplicated path to `expo-build-properties.android.packagingOptions.pickFirst` in the Expo app config, and keep the committed native Gradle properties synchronized when the native folder is tracked.