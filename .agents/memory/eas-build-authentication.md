---
name: EAS build authentication
description: Expo Application Services authentication needed before starting remote Android builds
---

Remote EAS builds require an authenticated Expo account in the shell. A configured APK profile, production API URL, and public Clerk key do not authenticate the EAS CLI.

**Why:** The CLI can fail before creating a build when neither a login session nor `EXPO_TOKEN` is available.

**How to apply:** Have the project owner run `eas login` interactively, or configure an Expo access token through the workspace's secret flow; never put the token in source, `eas.json`, or chat. Then rerun the non-interactive build command from `artifacts/auryx`.