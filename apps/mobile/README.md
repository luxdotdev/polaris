# apps/mobile

The Mobile App (`@polaris/mobile`): Expo React Native on Hermes, sharing `@polaris/protocol`,
`@polaris/client` and `@polaris/sdk` with the other Clients (ADR 0081): Home, Hosts and the
constellation view, in midnight, over one `HostConnection` per Host.

## Run it in the iOS simulator

Needs Xcode with an iOS simulator runtime (`xcodebuild -downloadPlatform iOS`) and CocoaPods.

```sh
bun run --cwd apps/mobile dev:daemon   # a dev Daemon; prints the dev bridge line
EXPO_PUBLIC_POLARIS_DEV_BRIDGE='polaris-dev-bridge:v1:…' bun run --cwd apps/mobile ios
```

`ios` is `expo run:ios`: it writes `ios/` from `app.json` (Continuous Native Generation, not
committed), builds, installs, starts Metro and opens the app. CocoaPods needs a UTF-8 locale
(`export LANG=en_US.UTF-8`). Later runs only need `bun run --cwd apps/mobile start`.

`dev:daemon` runs `polaris serve` from source on a throwaway `POLARIS_HOME` with the scripted
bench Harness (the SDK's test Daemon), registers a Workspace and starts two agent sessions. A
prompt such as `bench:{"approvalEvery":1,"approvalQuestion":{"question":"…","choices":["A","B"]}}`
makes a session ask for approval or answer, to try Home's inline replies.

## Hosts and the dev bridge

The app is a Client, not an Extension: every screen shares one `HostConnection` per Host
(`src/runtime/hostConnection.ts`), a `DaemonRpcs` client over a pluggable byte transport with
`@polaris/client`'s Connection State machine. `src/runtime/hosts.tsx` provides them to React
(`HostsProvider`, `useHosts`, `useHost`, `useHostStatus`, `useLiveHost`, `useHostRegistry`).
Release builds reach Hosts through the Polaris Relay; development builds also have the dev bridge.

`dev:daemon` starts the dev bridge (`scripts/devBridge.ts`): a WebSocket on 127.0.0.1 that
forwards each connection to the Daemon's Unix socket, so the simulator gets a Client's power. It
requires the random token the script prints and admits only its own Host and Origin (the one iOS
derives from the URL; the bridge serves no pages), so a web page can't reach it. Start Metro with the line it prints:

```sh
EXPO_PUBLIC_POLARIS_DEV_BRIDGE='polaris-dev-bridge:v1:…' bun run --cwd apps/mobile start
```

Only `__DEV__` builds read the variable; the bridge itself is a script and never bundled.

## Home and Hosts

`src/home/` is Paper H4. `feed/` follows each Host's feed (`openHostFeed` over its
`HostConnection`, so a Host offline at launch is followed once it connects) and folds it
(`fold.ts`); `model/` turns the folded Hosts into Home's sections, lines and replies; `ui/` draws
them. An approval whose command runs past four lines is answered in the agent session, never
inline. `scripts/home.daemon.test.ts` approves, denies and answers against a real Daemon.
`src/hosts/` is Paper M7: each Host's Connection State and route, read only.

The shell is `src/App.tsx` with `src/app/` (navigation, tab bar, back bar). `src/app/routes.tsx`
holds the routes for the thread, New agent session and Link screens.

## New agent session (M6)

`src/newSession/` is the sheet that starts an agent session: `NewSessionSheet({ onClose,
workspaceId?, onStarted? })`, which reads Home's followed feeds (`useFollowedHosts`) and calls the
Host's `DaemonRpcs` through its `HostConnection`. It follows the Desktop App's new-session rules:
the last used workspace with its Host, the most recently used ready Harness, the Models'
shortlist, in place unless New worktree is on (a branch from the prompt and the session's id).
The prompt draft stays on the phone until Start. Plan first starts in `plan` where the Host
announces `session.plan-mode`, and says "Asks before every edit" and sends `supervised` where it
doesn't (`permissionModeFor`, ENG-466). `scripts/newSession.test.ts` starts a real session on a
test Daemon through the dev bridge.

## The constellation view

`src/constellation/` is Paper C2: `ConstellationScreen({ hostId, constellationId, onBack? })` follows `constellation.subscribe` and re-reads `constellation.status` on each event; `model.ts` folds it into the lead row, the task bar and the rail (finished groups fold; a parent task has no row of its own). Accept approves the claim (`constellation.review`) and then messages the lead; Send back only messages the lead, who sends it back (`verdict.ts`). `scripts/verdict.test.ts` checks both against a real Daemon over the dev bridge.

## Push

Needs You and finished Turns arrive as notifications (apps/daemon/src/push/README.md). The Daemon
seals each one to this device's push key with HPKE; the relay and the push service carry it
opaquely; the Notification Service Extension opens it.

- `modules/polaris-push`: a local Expo module. `pushKey()` makes the P-256 push key on first use
  and keeps it in the Keychain group `HWD6374DUX.dev.lux.polaris.shared`, which the extension
  shares (accessible after first unlock, this device only). `rotatePushKey()` replaces it;
  re-register afterwards. `apnsEnvironment()` reads the provisioning profile: sandbox for
  development builds and the simulator, production otherwise.
- `targets/notification-service`: the extension (@bacons/apple-targets). It opens the payload
  with CryptoKit (`P256_SHA256_AES_GCM_256`), sets title, subtitle, body, thread and category, and
  keeps the routing ids in `userInfo.polaris`. If it can't open it, the generic alert stays.
- `src/push`: `usePush(identity, linkedHosts)` sets the categories, registers with each linked
  Host as its connection comes live (`devices.registerPush`, again after a reconnect), and answers.
  The `approval` category has Approve, Always here and Deny; each needs Face ID or the passcode and
  doesn't open the app. The answer is a RespondToApproval with a command id per request, sent
  once the Host's connection is live, within a background task (about 30 s).

### The widget hook

Each push the extension opens is added to the App Group `group.dev.lux.polaris`, UserDefaults
key `polaris.push.recent`: a JSON array, newest first, at most 20, of `{ kind, hostId, hostName,
sessionId, requestId, subtitle, at }` (no bodies). Then it calls
`WidgetCenter.shared.reloadAllTimelines()`. Widgets read the array in their timeline provider.

### Try it in the simulator

`app.json` sets `aps-environment` to development; Xcode switches it to production when exporting
for TestFlight or the App Store. The simulator has no APNs token, but `xcrun simctl push` runs the
extension: seal a PushMessage to the key `pushKey()` returns (`sealPush` in
`apps/daemon/src/push/seal.ts`) and send
`{"aps":{"alert":{"title":"Polaris","body":"Open Polaris to see what changed."},"mutable-content":1},"p":"<sealed>"}`.

## The Hermes check

`src/runtime/selfCheck.ts` exercises Effect 4, the frame codec and pairing strings, the
Connection State machine and the resumable feed. The app runs it at startup in development, and
`bun run test` runs it on Hermes:

- `hermesc` (the `hermes-compiler` React Native ships) must compile the bundled check, always;
- the `hermes` VM runs it when one is built: `bun run --cwd apps/mobile hermes:build` (git,
  cmake and ninja) builds it from facebook/hermes at the release React Native's prebuilt
  `hermes-engine` uses, into `node_modules/.cache/hermes/<version>`.

`bun run --cwd apps/mobile hermes` runs the same check and prints each result.
`src/runtime/vmHost.ts` supplies the two things React Native adds over the bare VM that the check
needs: `console` and timers that honour their delay.

## Tokens

Colours and type come from `@polaris/ui/tokens` (Midnight and the mobile type scale), plain
constants with no DOM or Tailwind.
