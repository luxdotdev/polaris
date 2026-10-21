---
status: accepted
fixes: GitHub tokens and downloads could be intercepted with a certificate forged through eMudhra's weak G3 intermediate keys (October 2026)
---

# The Desktop App refuses distrusted CA keys

## Context

In October 2026 eight eMudhra G3 intermediates (six TLS, two code signing) turned out to have
P-384 private keys between 1 and 255, recoverable from their public certificates. Sectigo's
"AAA Certificate Services" root had cross-signed all eight. So any client that trusts that root
and doesn't check revocation or Certificate Transparency accepts a certificate forged for any
hostname: Node's bundled roots, curl, Python, Go before 1.27.3. Chrome and Firefox blocked them
through CRLSets and OneCRL. Electron gets neither, and doesn't enforce CT.

The Desktop App's internet traffic goes through two stacks:

- **Chromium's (`net.fetch`, ADR 0053):** the GitHub client and its OAuth tokens, the update
  feed's preflight, and prices.
- **Node's (`node:https`):** the editor preview's external images, which pin their socket to a
  checked address.

The Client's Daemon download used Node's global `fetch`, against ADR 0053. The download is
checked against the signed app's manifest, so a forged server could only make it fail.

## Decision

The main process refuses any chain containing a certificate whose SubjectPublicKeyInfo hashes to
a distrusted key (`apps/desktop/src/main/tls/distrust.ts`), the same list and method as Go
1.27.3's `distrustedSPKIHashes`.

- **Keys, not certificates:** the cross-signs and any reissue carry the same key, so one hash
  covers them all.
- **Chromium:** `session.defaultSession.setCertificateVerifyProc` before the first request. A
  chain without a distrusted key keeps Chromium's own verdict (`-3`).
- **Node:** `checkServerIdentity` on each `node:https` request; it runs the usual hostname check
  after the key check.
- **The Daemon download** moves to `net.fetch`.
- **Electron** moves to 44.9.3 for its Chromium and Node fixes. Node 24.22 already refuses these
  chains, but the Desktop App's own check doesn't depend on what Electron bundles.

The test fixtures are a throwaway root, an intermediate on the weak key 4 (EM OV TLS CA - G3C's)
and one on a normal key, each with a `localhost` leaf.

## Consequences

- A new distrusted key is one line in `DISTRUSTED_SPKI_SHA256`, and a release.
- The Daemon's own downloads (Bun `fetch`) are not covered. Each is checked against a hash built
  into the Daemon, so a forged server can only make them fail.
- Harnesses (Claude Code, Codex) make their own TLS connections, with their own tokens. They
  are protected only once their own releases are.
- Windows updates are not covered: Squirrel.Windows downloads them itself, and Windows builds are
  not code-signed, so its RELEASES hash is only as good as TLS. Signing Windows builds closes it.
