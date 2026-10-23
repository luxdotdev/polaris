# Pairing UX and CLI review (ENG-401)

Reviewed D at `a964ce4545d7a5b431f904e54b6fba6122d4099f`, including the accepted
dependency head `e42016017ead6bc2d018527c4ebf07e14daa11d2`.

The developer pairs an Extension with a named Host, chooses its Grant, transfers
the one-time credential, and can revoke it. The Daemon's successful responses
are authoritative. This review preserves that flow and hardens its failure
states (`rule/design-reachable-states`, `rule/remote-is-normal`).

## Fixed findings

- **P1 — CLI terminal injection.** Pairing names, ids and error text were printed
  verbatim. Control characters could forge output lines or issue terminal
  commands, including clipboard escape sequences. Dynamic terminal text now
  escapes controls, bidirectional formatting and Unicode line separators. The
  encoded pairing string preserves the original name. Tests cover list output
  and real CLI pair/revoke/error output through a disposable Daemon.
- **P1 — Successful pairing could lose its one-time reveal.** The renderer
  awaited a separate list request after pairing. A failed refresh hid the
  credential even though the Pairing had already been created. Pair/revoke now
  update the metadata list from their successful RPC results; the credential
  crosses directly to the reveal. A failed revoke retains the row and reveal.
- **P2 — Revoking a revealed Pairing left its credential visible.** A successful
  revoke now closes the matching reveal as it removes the row. Regression tests
  cover successful and refused revocation.
- **P1 — QR capacity failure prevented credential delivery.** Both the renderer
  and terminal encoder could throw for an oversized, valid pairing string.
  Settings now explains that the string must be copied; the CLI still prints
  it. Tests exercise oversized payloads. In detached copies, removing only the
  fallback catches makes both capacity tests fail with `RangeError: Data too
  long`; restoring them makes both pass.
- **P1 — Smoke artifacts could retain credentials.** The pairing smoke helper
  included the full credential in a failure message; screenshots captured the
  text and QR. The error now omits it, normal screenshots mask the reveal, and
  failure artifacts replace the reveal before capturing the screen and text.

## Other reviewed boundaries

- Pairing strings retain the v1 prefix and unpadded base64url JSON contract,
  including Unicode and a null Remote Access URL. Malformed input returns none.
- Pairing metadata has no token field; the Daemon store persists a SHA-256 hash.
  The renderer holds the credential in the transient reveal, with no settings,
  browser storage or event-store write on this path. Done/unmount discards it.
- IPC decodes each Extension request before dispatch. Added tests pass malformed
  grants, names, ids and Host keys through the real request runner and assert
  rejection before Host access.
- Existing real-transport tests cover revocation closing live connections,
  idempotent revocation, rejected tokens and connection admission.
- No protocol, engine lifecycle or Daemon hot-path changes were needed. No spec
  or performance baseline changes were made.

## Verification and limits

- Final targeted renderer/IPC/pairing-string suites: 33 pass, 0 fail.
- Final Pairing store/connection/CLI suites: 21 pass, 0 fail, including a real
  spawned Daemon with fake Harnesses and disposable `POLARIS_HOME`.
- Real transport/Extension security suites before the QR-only change: 31 pass,
  0 fail. The QR change does not alter transport behavior.
- Root typecheck: 12/12 tasks pass, 10 cached and 2 fresh. The runner emitted two
  `Operation not permitted` cache I/O warnings without failing.
- Final root tests: 12/12 tasks pass, 10 cached and 2 fresh. The fresh Daemon
  suite has 2,460 pass and 45 skip; the fresh Desktop suite has 2,819 pass.
  The skipped tests include platform-specific and live-provider checks.
- Final root lint: formatting and ratchet pass without increasing a baseline.
- React Doctor against the assigned base: 92/100, no errors, two unchanged
  smoke-loop warnings outside this review.
- The first restricted CLI test could not bind a listener; its authorized rerun
  with local-listener access passed. An initial detached QR proof could not
  resolve React from the root dependency directory; using the Desktop App's
  dependency directory fixed the proof setup.
- The final Desktop build passed. Smoke failed in `freshStartFlow` at
  `electronApplication.firstWindow` (30-second timeout), before Extensions.
  Its Electron process also stalled during close; only this run's verified RD
  process was terminated to release the smoke lease. Screenshot masking, the
  failure capture path, themes/densities, keyboard focus, Reduce Motion and the
  colourblind palette have not been visually verified in Electron.

No additional unfixed defect was confirmed within this review's scope. The
remaining Desktop smoke/visual acceptance belongs to ENG-401.
