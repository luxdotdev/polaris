# Joint language functional batch

Source preparation only. Heavy execution remains held until J1 freezes and releases the joint
candidate. U1's earlier Settings archives remain immutable. This supplemental module is the only
new Area: `tooling/language-fixtures/joint/` (Lead3537/3560 delegation).

After J1 source freeze, through its existing authorized single-owner `m31-bench` wrapper:

```sh
node tooling/language-fixtures/joint/run.ts /tmp/m31-j1-functional-new
```

The output directory must not already exist. The supervisor inherits HOME without overriding it,
removes coordination variables by an environment allowlist, and gives the child a private
POLARIS_HOME and isolated Git settings. It starts one detached owned worker process group, one
Vite loopback server with no HMR/watch, and one installed Electron binary, profile and BrowserWindow.
No dependency download or provider execution. All cases run sequentially on the same window/origin;
navigation to about:blank releases the preceding renderer lifetime. External origins are blocked.

`manifest.ts` fixes launch at30s, individual actions10s, navigation20s, each case90s and outer330s.
Outer expiry sends TERM then KILL after5s to the owned group only; finally it reaps/reads group absence
and removes its own root only after absence. Evidence is retained, never removed by the runner.
Normal worker finally closes Electron/server. A stalled finally is covered by the supervisor.
A remaining live group prevents root removal and makes the command fail. `owned.json`, `run.log`
and `cleanup.json` record actual exit, timeout, process-group absence and root removal; a successful
inner result alone is insufficient. No ps/global/user/peer cleanup.

`sources.json` binds19 fixture/assertion/storage recipe files from applied J1 sources. Preflight
hash mismatch stops before Electron rather than silently consuming changed peer fixtures. J1 must
review any mismatch against its deliberate final freeze and publish a replacement binding if
needed. `source-binding.json` records fixture hashes and installed joint lock/package/Vite config
hashes; J1's union source/config receipts bind all transitive product sources and this runner.
The immutable supplemental handoff manifest separately records every runner file hash.

Cases and evidence:

1. Settings: existing `integration.evidence.html` and `verifyLiveFeed` (which calls
   `verifyConfirmedPolicy`) preserve dirty draft, owned progress, foreign/late exclusion,
   disconnect/reconnect, exact grant/revoke/failed/foreign/cancelled-late policy acknowledgements
   and matching/unrelated preview epochs. Existing dark/light feed screenshots are retained;
   there is no new full density/theme/performance matrix. Actual Page/UI, scripted typed API;
   no real Host installation/activation or socket proof.
2. Editor: existing `lsp/evidence.html`, `window.languageProof.run()` and `.cleanup()`.
   Reuses unsaved Unicode sync, completion/undo, held stale hover/cancellation, diagnostics,
   independent roots, hidden-buffer authority and reconnect assertions. Cleanup requires zero
   watches/contexts/subscriptions. Actual CodeMirror; scripted LanguageApi/Files, no real server.
3. Resources: existing `resourceProof.collision/offer/accepted/restored` and exact visible
   Accept/Recover/Undo selectors from R1's resources-only runner. Native strict IndexedDB readback,
   actual UI and CodeMirror; scripted Host receipts/Files. The native discard port reuses R1's
   held third list read, intervening live edit and injected persistence refusal. It uses isolated
   native localStorage/strict IDB, checks unchanged complete originals/proposal/fingerprint and
   advanced conflict revision through a fresh IDB connection. The held wait precedes the IDB
   intervention transaction. The alert is the fixture displaying a caught product error, not
   CloseDialog/tab-close UI evidence. No process restart/SIGKILL recovery or filesystem/socket
   certification is claimed.

Each case writes result.json and one completion screenshot; existing Settings hook writes its own
raw evidence. First assertion/pageerror/blocked-request failure stops the batch, captures
failure.png, failure.html and failure.json (stage, completed cases, errors), then cleans up.
Prelaunch import/hash errors remain in run.log and cleanup.json since no renderer exists yet.
No benchmark samples are collected. No fake receipt or passing batch grants native/artifact approval.

Cheap preparation evidence: html.test.ts checks fixture-root script rebasing and retained containers
(1pass4assertions). Scoped worker quality initially found spacing/readonly facts, corrected.
All runner files except native-discard.testing.ts pass worker scoped quality; that module's typed
quality is pending J1 because this worker base lacks the frozen R1 refactors modules and still has
an older synchronous discard API. No casts, stub producer types, disables or baseline increases
were introduced to conceal missing peer source. Full shared types/quality and actual functional
execution remain pending; this authored harness is not a successful runtime receipt.
