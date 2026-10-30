---
status: accepted
amends: ADR 0088
---

# The widget reads the push key from the App Group

## Context

ADR 0088 has the widget extension open each Live Activity slice with the push key from the
shared Keychain group. In the simulator it did. On a device (build 9, ENG-608) every slice came
up unreadable: the lock screen said "Nothing working" and "Open Polaris to see every host" while
sessions worked, for slices the Daemons pushed and for those the app sealed itself.

Delivery was fine: the relay sent every update. The crypto and the decode were fine too: a slice
sealed by the Daemon's `sealSlice` opens with the extension's Swift on macOS
(`apps/daemon/src/push/live.widget.test.ts`). The Notification Service Extension reads the same
Keychain item with the same query and opens pushes, and the signed widget carries the same
`keychain-access-groups`. That leaves the widget's Keychain read while it draws the activity.

## Decision

**polaris-push keeps a copy of the push key's private half in the App Group container; the
widget reads the Keychain first and falls back to that copy.**

- The copy is `push-key-1` in `group.dev.lux.polaris`, written with
  `completeFileProtectionUntilFirstUserAuthentication`: as readable as the Keychain item
  (`AfterFirstUnlockThisDeviceOnly`), so the lock screen can draw after the first unlock.
- polaris-push writes it when it makes or rotates the key, and mirrors an existing key on the
  app's next `pushKey()` call, so installs from before this change gain it on launch.
- The widget logs, in Release, why a key or a slice failed: the Keychain status, a missing or
  unreadable copy, or where opening stopped (malformed, open, decode with the field's path).
  Subsystem `dev.lux.polaris.widgets`, category `live`. Never the content.

## Consequences

- The key is now also protected by file data protection inside the App Group, not only by the
  Keychain. Only apps and extensions signed by our team with that group can read either. The
  copy is in device backups' scope, where the Keychain item (`ThisDeviceOnly`) is not: a restored
  backup on another phone carries a key no Host seals to any more once the device re-registers.
- The Notification Service Extension keeps reading the Keychain; it works there.
- If the device logs show the Keychain read succeeding, the fallback is dead weight and the
  cause is elsewhere: the logs say which step failed.
