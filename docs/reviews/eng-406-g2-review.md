# Even G2 review (ENG-406)

Reviewed Task I at `f07747762887f190ebd0e0381581e7c3504186d9` on 2026-10-23.
The changes in this review address the following findings.

| Severity | Finding | Result |
| --- | --- | --- |
| High | A final transcript switches the model to Send before the delayed BLE page appears; a tap intended to stop recording could send it. | Action taps require the exact page to have been drawn successfully. Releases and cancellation remain available. Refused text updates are retried; closing cancels queued display work. |
| High | Send chose the question open at send time, including one that arrived during dictation. | A recording retains its original question ID (or new-Turn intent). A changed or removed question refuses Send and asks the user to cancel and reopen the session. |
| High | PCM frames accumulated without a bound; cancellation drained unread audio, and delayed microphone start/cleanup could affect a retry. | The queue holds at most 64,000 bytes or 256 frames, copies retained buffers, and discards unread frames on cancellation/overflow. Overflow stops recording. Microphone release precedes the next recording; finished transcripts close their iterator. |
| High | Concurrent reconnects could take the same generation after awaiting close, leaving an extra client alive. Visibility events could also reconnect after exit. | Reserve the generation before awaiting close, discard superseded connections, and seal the app on exit. Interrupted voice offers Retry. |
| High | Long Host names, empty-menu titles, empty-list notices and voice errors could exceed the glasses' text limit and blank/refuse the page. | All full pages and voice errors are byte-clipped; Host names receive a budget inside the session page. Existing 63-byte list clipping remains in place. Grapheme tests cover joined emoji and combining accents. |
| Medium | Peer close reasons entered Daemon diagnostics with control characters and no explicit cap. Captured console errors were forwarded without redaction. | Strip controls and formatting controls, redact pairing strings and `pol_ext_` tokens, cap close reasons at 80 characters and Wire diagnostics at 2,048. Phone log lines cap at 1,000 characters and 40 lines. Console forwarding is redacted; handled uncaught errors/rejections suppress the browser's raw fallback. Opening-address logs omit userinfo, query and fragment. |

The display and recovery changes follow `rule/long-content-survives` and
`rule/design-reachable-states` in the product-design skill. No visual theme,
density, colour, or layout direction changed.

## Checks on the existing implementation

- Pairings live in the Even WebView's `localStorage`, under `polaris.pairings`, as
  encoded pairing strings. They do not use bridge storage and are not encrypted
  by this app. Unpair rewrites that list; it does not revoke the Daemon's token.
  No diagnostic upload path was found in the app. This review does not establish
  the vendor WebView's backup, origin-isolation, or storage durability guarantees.
- The Connection log and Host errors render with `textContent`, never HTML.
  Peer-provided markup is inert. Redaction also applies to described Host errors.
- Holding or choosing Speak streams PCM to the Host's transcription RPC. Only
  the explicit, displayed Send choice sends the transcript to an Agent Session.
  Approval and fixed-reply menu choices are explicit actions; feed updates do not
  invoke commands. The README now distinguishes PCM streaming from transcript Send.
- Whitelist generation uses parsed web origins, rejects non-web schemes and
  userinfo, deduplicates origins, and expands a bare Host to HTTPS and WSS. The
  packaged smoke lists only `https://ri-review.invalid` and
  `wss://ri-review.invalid`. The whitelist is not a security boundary: Task I's
  device evidence says Even does not enforce it for WebSockets.
- All six files bearing the `evenhub-templates@8cb01354` adaptation header match
  ATTRIBUTION.md: `index.html`, `vite.config.ts`, `src/main.ts`,
  `src/glasses/input.ts`, `src/glasses/bridge.ts`, and `src/phone/page.css`.
  Attribution pins full commit `8cb01354f5ee914c5fab97d06e6d13b28eeb5815`, MIT,
  and the copied licence. No upstream code was added by this review.

## Evidence and limits

- Final repository checks: typecheck 15/15 (14 cached); tests 16/16 (15 cached,
  fresh G2). The preceding full run freshly exercised the Daemon: 2,530 pass,
  45 platform/live-service skips, zero failures. Format/lint pass without baseline
  changes. Licence check: 753 production dependencies plus nine platform builds,
  zero violations (10 existing exceptions).
- The G2 suite passes 67 tests, including real throwaway-Daemon gateway tests.
  Glasses and microphone behavior use the fake bridge; no real glasses or live
  speech provider were used in this review.
- Restoring the original production files makes 19 regression cases fail.
  Separately disabling the display safeguards makes three further cases fail:
  premature Send, a refused text update treated as visible, and drawing after exit.
- A production `.ehpk` was built twice with different fake
  `VITE_POLARIS_PAIRING` and unused-secret environment values. Both packages are
  byte-identical, SHA-256
  `0f12a9e0a6f7e5b753165383f02cd05a82425b3a20a48117ba105f17ddb67cac`.
  All packed HTML/JS/CSS and manifest inputs contain neither sentinel nor
  credential-like pairing/token literals. The package's custom binary format was
  not independently unpacked. No upload or beta promotion was performed. The
  pack CLI could not reach npm and used its bundled minimum-app-version floor.
- `sessions --quick` was compared with the committed Mac14,13 baseline for both
  original and patched Daemon sources, one run each. Both comparisons exit 1.
  Original: m10c3 dispatch-to-event p99 32.23 ms vs 5.35 ms baseline. Patched:
  m5 dispatch-ack p50 27.97 ms vs 14.73 ms baseline. Patched burst p99 also rose
  to 50.46 ms vs 1.93 ms (non-gating). The Host had 2.7–3 other cores busy;
  these different failures do not isolate a patch regression or establish a
  performance pass. Baselines and tolerances were not changed. These session
  scenarios use the socket; the changed gateway diagnostics run only on closure.
- Initial sandboxed gateway tests could not bind loopback, and benchmark attempts
  exited 127 before output. Authorized runs outside the sandbox exercised real
  throwaway processes. An initial new-test type assertion and grapheme expectation
  were corrected; normal formatting/lint fixes did not change any baseline.

Hardware acceptance of dictation, cancellation, Retry, and delayed-page Send is
still required at gate K under ENG-406. Task I's earlier device evidence is
historical, not fresh verification of these review fixes. Real-Daemon pairing,
live provider speech, off-Mac reachability and the listing/icon follow-up
(ENG-424) remain with their existing gates/issues.
