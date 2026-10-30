# The Browser's CDP facade

Agents drive a session's Browser over CDP (ADR 0092): agent-browser connects to the Daemon's per-session relay, the Daemon opens a `cdp` Browser stream to the Desktop App hosting the session, and this folder answers it (ENG-616). The tabs themselves belong to `../browser`; this folder reaches them through the `CdpTabs` port (`ports.ts`, `adapter.ts`).

## One stream, one facade

`hostBrowsers(sessions, deps)` runs on each Host that supports `browser.host` (`host.ts`): every `Open` the Daemon sends becomes a `cdpFacade` over that session's tabs, fed by the stream's bytes and writing its replies back, within the byte-stream credit window. Streams are known only to the connection that opened them. When the connection drops, every facade closes and detaches.

## What the agent sees

The facade is a browser-level endpoint over one session's tabs:

- `Browser.getVersion`, `Target.setDiscoverTargets`, `Target.getTargets`, `Target.getTargetInfo`, `Target.attachToTarget` (flatten only), `Target.detachFromTarget`, `Target.setAutoAttach`, `Target.activateTarget`, `Target.closeTarget`, and `Target.createTarget`, which opens a tab in the session's Browser `openedBy Agent`. Target ids are the Browser's tab ids; browser context id is `polaris:<sessionId>`.
- Every other method needs a `sessionId` from `attachToTarget` and goes to that tab's `webContents.debugger` (`hub.ts`), including the sessions Chromium opens under the tab (frames, workers). A browser-type target under a tab never routes.
- Another session's tab is no target: `No target with given id found`.

Refused with code -32000 (`refusals.ts`): everything browser-wide (`Browser.close`, `Browser.grantPermissions`, `Browser.setWindowBounds`, `Browser.setContentsSize`, `Target.createBrowserContext`, `Target.attachToBrowserTarget`, `Target.exposeDevToolsProtocol`, the `SystemInfo`, `Tethering`, `Memory`, `HeadlessExperimental`, `Extensions`, `PWA` and `Autofill` domains, and the rest of the list in `REFUSED_METHODS`), `DOM.setFileInputFiles` (it reads files on the Desktop App's machine), and `Browser.setDownloadBehavior`/`Page.setDownloadBehavior` other than `deny`/`default` without a path. `Page.navigate` follows the Browser's navigation policy (`allowedUrl`).

## Driving a tab

One `DebuggerHub` per `webContents` (`hub.ts`): facades share an attachment; the last one detaches. On every attach the hub sends `Emulation.setFocusEmulationEnabled`, because Chromium drops synthetic input on a tab that isn't focused, and the session's Browser is often not on screen. Opening DevTools detaches `webContents.debugger`; the hub reattaches while a facade still holds the tab, and ends the sessions with `Target.detachedFromTarget` if it can't. Attached tabs show the agent-driving indicator (`setAgentDriving`).

The relay opens each stream with `Polaris.hello { tabs }`, the tabs it remembers; a facade over a session with no tabs reopens their URLs (`openedBy User`), so a Desktop App taking the Browser over shows the same pages. The facade reports `Polaris.tabs` after every change. Neither reaches the agent.

## Tests

`facade.test.ts` covers filtering, refusals, routing and the hub with a fake debugger. `apps/daemon/src/browser/smoke.e2e.test.ts` runs the real agent-browser through the real relay to a real `WebContentsView` in Electron (`smoke/electronMain.ts`, a stand-in Desktop App behind the same port).
