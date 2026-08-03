---
name: Metro watchers after pnpm relinks
description: Expo Metro can retain filesystem watchers for temporary pnpm package paths after dependency installation.
---

After changing or reinstalling Expo dependencies, restart the exact Expo workflow before diagnosing a Metro `ENOENT` watcher failure. The stale path is usually a deleted pnpm temporary package directory, not an application error.

**Why:** Metro's fallback watcher may keep observing a pnpm link while pnpm is replacing the package, and the next callback can fail after the temporary directory disappears.

**How to apply:** Confirm the temporary path no longer exists, then restart the managed Expo workflow. Avoid changing application code or adding unrelated dependencies unless the failure persists.