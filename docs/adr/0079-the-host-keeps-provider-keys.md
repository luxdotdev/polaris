---
status: accepted
implements: ENG-404 (voice keys), ADR 0077
---

# The Host keeps provider keys in its own secure storage

## Context

Voice relays audio through the Daemon to Deepgram with the user's key (ADR 0077). The Desktop
App's `SecureStorage` (ADR 0044) lives in the Client, but the key must stay on the Host, which
may be a remote Mac, a Linux VM or a Raspberry Pi with no desktop session or keyring.

## Decision

`HostSecrets` (`apps/daemon/src/secrets/`) stores secrets by namespaced key (`voice/deepgram`):

- **macOS:** a generic password in the user's login Keychain (service `dev.lux.polaris`, the key
  as the account), through `/usr/bin/security`. The value goes on `security -i`'s stdin, never in
  argv, and is read back to confirm, since `security -i` exits 0 when its command fails.
- **Elsewhere:** `~/.polaris/secrets/<key>.secret`, mode 0600 in 0700 directories, written
  through a rename and opened with `O_NOFOLLOW`. As in ADR 0044's POSIX fallback, this is no
  weaker than the user's other files under `~/.polaris`.

Clients set and clear a key (`voice.setKey`, Settings) and learn only whether one is set
(`voice.settings`); `polaris voice key set` does the same on the Host, reading the key from
stdin. Both RPCs are Client-only, never granted to Extensions. The Daemon reads the key when a
transcription starts, so a new key applies without a restart.

## Consequences

- The key never reaches a Client or an Extension, and never appears in logs, errors or argv.
- On a Mac whose login Keychain is locked (a Daemon started over SSH before anyone logged in),
  setting or using the key fails with a message saying so, instead of falling back to a file.
- Linux desktops with a Secret Service keyring still use the file; using libsecret is a
  follow-up (ENG-416).
