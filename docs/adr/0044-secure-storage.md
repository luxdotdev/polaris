---
status: accepted
implements: ENG-290 (SecureStorage), ADR 0040 Q17; fixes platform-seams bug B5
---

# One SecureStorage for the Desktop App's secrets

The Desktop App keeps secrets at rest: GitHub tokens, the language identity
proof, and soon Classifier backend keys (ADR 0040, Q17). Before this, each
secret stored itself. GitHub sealed its tokens with Electron's `safeStorage`
behind a private `Crypto` interface. The language proof was a plaintext file
guarded by POSIX checks, which can never pass on Windows (bug B5 in
`docs/research/platform-seams.md`), so language identity was silently off
on every Windows Client.

## The service

`SecureStorage` (`apps/desktop/src/main/secure/`) has one API: `get`, `set`
and `delete` by namespaced key (`github/tokens/1001`,
`languages/client-proof`, later `classifier/<backend>`), plus `available`.
Keys are checked against a schema: lowercase segments, none starting with a
dot. Failures are `SecureStorageUnavailable` (with `reason`: `no-backend` or
`plaintext-backend`) and `SecureStorageError`.

Layers:

- `files({ dir, sealer, adopt })`. In the app the sealer is `safeStorage`'s
  async API (`secure/electron.ts`, the only file that imports it). That
  means the Keychain on macOS, DPAPI on Windows, and libsecret or kwallet on
  Linux. When Linux falls back to `basic_text`, which encrypts with a
  hardcoded password, the store reports `plaintext-backend` and refuses to
  read or write. A record whose OS key rotated is sealed again on read.
- `memory`, for tests.
- `unavailable(reason)`, for a machine with no store.

## Where the records live

Each key is one sealed file: `<userData>/secure/<namespace>/…/<name>.bin`.
The bytes are exactly what `safeStorage.encryptStringAsync` returns, the
same format GitHub already wrote. Writes go through a temporary sibling and
a rename, so a crash never leaves half a record. Keeping the files in one
`secure/` directory, apart from each consumer's ordinary data, puts every
secret in one place and keeps keys from colliding with a consumer's own
files. Deleting a record is deleting its file, which works even when no
store is available.

The OS store holds only the key `safeStorage` seals with, never the records
themselves. That's what Electron supports on all three platforms. It also
means Polaris asks the keychain for one item instead of one per secret.

## Migrating GitHub tokens

Tokens used to live in `<userData>/github/tokens/<id>.bin`, sealed the same
way. When the store opens, it adopts that directory (`adopt`): each record
is renamed to `secure/github/tokens/<id>.bin`. When a newer record already
exists there, the old one is deleted instead. The directory is removed once
empty. Nothing is decrypted, so nobody signs in again and the upgrade causes
no keychain prompt. `accounts.json` stays where it was because it holds
nothing secret.

## What replaces the POSIX checks on the language proof

The proof is 32 random bytes. Its hash per Host is this Client's language
identity (ADR 0014). Anyone who knows the proof can claim that identity on a
Host, and anyone who can choose it knows it in advance. The old file store
protected the proof in two ways:

- **Confidentiality from other OS users:** mode `0600` in a `0700`
  directory, both owned by the running uid.
- **Integrity against planted or redirected records:** `O_NOFOLLOW`, a
  single hard link, an exact size and format, and no repair of a record
  that fails these checks.

`SecureStorage` keeps both properties with the OS user's key instead of file
metadata, and that works on every platform:

- **Confidentiality.** The proof is sealed by a key only the user's session
  can use: the Keychain item's access list on macOS, the user's DPAPI master
  key on Windows, the unlocked keyring on Linux. Another user who reads the
  file gets ciphertext. Processes running as the same user could read the
  old `0600` file too, so nothing is lost there. On macOS the Keychain's
  access list is stricter than a file mode.
- **Integrity.** A record that the user's key didn't seal fails to open, and
  a link to someone else's file fails the same way. The decoded proof must
  still be 64 hex characters. As before, a stored proof that won't open or
  doesn't decode turns language identity off with a warning and is never
  replaced. Only an absent proof is created.

## Fallback and migration on POSIX

- **SecureStorage available:** the proof lives there. An existing POSIX
  proof file that still passes the old checks is adopted unchanged, so the
  identity carries over, and then the file is deleted. A file that fails the
  checks is refused and left alone, as before.
- **No usable store (Linux without a keyring, or `basic_text`):** the
  POSIX file store stays in use. It is no weaker than before, and a Linux
  Client without a keyring keeps language identity.
- **Windows:** the proof always goes through SecureStorage (DPAPI). The
  POSIX file is never read there. With no store, identity is off and the
  Client logs a warning; it never falls back to an unprotected file.

## Consequences

- Language identity now works on Windows.
- Every Client reaches the OS store at startup, not only Clients with a
  GitHub account. A properly signed app gets no prompt. An ad hoc signed
  build changes its signature with every build, so macOS may ask once per
  update before the Keychain hands over "Polaris Safe Storage".
- If the user resets their keychain, every sealed record stops opening.
  GitHub accounts show the keychain error and need signing in again, and
  language identity stays off until the record is deleted. Polaris doesn't
  repair records silently.
- New secrets (Classifier backends) take a namespace and need no storage
  code of their own.
