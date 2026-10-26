# ENG-407: release jobs review

Reviewed J at `0bc8457fc3681bcfd5da2187044b48745d63ee4d` (J head `b294f5f2`).

## Findings addressed

- **Medium — Raycast blocked the signed app release.** A failed optional extension build now
  leaves its job red while allowing the signed Desktop App and Daemon draft. Downloads and
  checksums are gated on job success, including the case where upload fails after computing
  a checksum. The Windows checksum now follows the same rule.
- **Medium — SDK and Polaris prereleases used different version schemes but shared a tag
  decision.** Publishing stable SDK `0.1.0` from a Polaris prerelease previously put it under
  `next`; a stable rerun skipped that existing version and never established `latest`.
  The SDK's own version now determines `next` or `latest`. Existing versions stay skipped;
  no dist-tags are reconciled. This is the Lead's requested policy.
- **Supply-chain hardening — remove the long-lived npm token.** The npm job uses OIDC only,
  in environment `npm`, with pinned Node 24.22.1 and its bundled npm 11.19.1. It still checks
  the tarball digest, downloads by artifact ID, checks out no repository, and publishes with
  provenance, public access and lifecycle scripts disabled.
- **Defense in depth — keep `.ehpk` files out of Releases.** The explicit artifact download
  list is tested, and the draft step refuses `.ehpk` files even in a digest-checked handoff.
  G2 remains an artifact for manual Even Hub upload. Workflow artifacts follow repository
  access rules; being absent from a Release does not make an artifact a secret store.
- **Test coverage — exercise the shell and broaden authority checks.** Secret detection now
  includes job environments and step inputs/scripts. Tests execute the actual workflow shell
  with fake npm, GitHub and pack commands, including command substitution and glob characters
  in `EVEN_G2_HOSTS`. The shell passes data as arguments without executing it.

The `sign → dmg → sign-dmg` chain is unchanged. Drafting still requires both signing jobs to
succeed. SDK publication remains independent of Apple signing, consistent with its separate
version. External actions stay SHA-pinned. The SDK's published name, README imports and
repository metadata agree; Raycast and G2 continue using the internal `@polaris/sdk` workspace.

## Validation

Local runtime: Node 24.22.1 and Bun 1.4.4 on macOS.

- `bun run typecheck`: 15/15 tasks, 10 cached; final run 14.163 seconds. Sandbox cache writes
  reported permission warnings but no task failed.
- `bun test tooling/release`: 40 pass, 0 fail. This includes 11 new shell-boundary scenarios.
- Seventeen workflow mutations each caused failures: unpinned action, unexpected write,
  build-job secret, signer artifact by name, npm scripts enabled, SDK digest omitted,
  provenance omitted, OIDC authority removed, npm token restored, npm environment mixed
  with signing, wildcard publisher download, interpolated G2 Hosts, G2 globbing enabled,
  Raycast blocking the draft, Raycast digest omitted, `.ehpk` guard omitted, and Polaris-based
  npm dist-tags restored. The workflow was restored after every mutation. An initial mutation
  targeted the upload instead of the download; correcting its target made the intended
  download regression fail.
- The first full repository test run stopped with 66/67 G2 tests passing: the existing
  `voice > says so when the Host has no speech-to-text key` case timed out selecting a session,
  before reaching its voice assertion. The unchanged G2 suite passed 67/67 in isolation.
  That initial failure interrupted the Daemon suite. The full retry passed all 16 tasks in
  5m53.298s (13 cached, three fresh: tooling, G2 and Daemon). Daemon: 2,530 pass, 45 skip, 0 fail;
  G2 passed 67/67. The final shell-test assertions were then checked by the focused release
  suite and the tooling typecheck.
- The first run's SDK suite passed 38/38, including packing the renamed package, plain Node
  and browser imports against a real throwaway Daemon, and consumer declaration checks.
- `bun run lint` passed with no baseline changes. The commit uses normal hooks.

The shell checks use fake command boundaries, not a live registry or GitHub Release. They do
not verify Ubuntu packaging, npm OIDC/provenance service integration, Apple signing or Even Hub
upload. No release was created, no tag pushed and no npm settings changed by this review.

## Remaining work

- [ENG-425](https://linear.app/luxdev/issue/ENG-425): the owner confirmed on 2026-10-24 that
  SDK `0.1.0` is published as `latest` and the trusted publisher is registered for
  `luxdotdev/polaris`, `release.yml`, environment `npm`, allowing `npm publish`. This is owner
  confirmation, not an OIDC run observed by the reviewer. Its initial registration expires
  after two days without a publish; re-register if it expires before the next SDK version
  bump. Verify that next version's OIDC publication, provenance and GitHub-hosted pack jobs.
- **Medium — [ENG-426](https://linear.app/luxdev/issue/ENG-426):** the existing G2 manifest
  builder accepts `*` as a Host, producing `https://*` and `wss://*`. This was reproduced
  directly. Shell globbing is disabled, but stricter origin validation belongs in the G2
  packer and remains deferred.

Reference: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/). Runtime pins
were read from the [official Node release index](https://nodejs.org/dist/index.json).
