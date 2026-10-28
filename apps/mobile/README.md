# apps/mobile

The Mobile App (`@polaris/mobile`): Expo React Native on Hermes, sharing `@polaris/protocol`,
`@polaris/client` and `@polaris/sdk` with the other Clients (ADR 0081). This is the scaffold: one
plain list of a Host's agent sessions over the gateway. The product screens come later.

## Run it in the iOS simulator

Needs Xcode with an iOS simulator runtime (`xcodebuild -downloadPlatform iOS`) and CocoaPods.

```sh
bun run --cwd apps/mobile dev:daemon   # a dev Daemon; prints a read-only gateway pairing
EXPO_PUBLIC_POLARIS_PAIRING='polaris-pair:v1:…' bun run --cwd apps/mobile ios
```

`ios` is `expo run:ios`: it writes `ios/` from `app.json` (Continuous Native Generation, not
committed), builds, installs, starts Metro and opens the app. CocoaPods needs a UTF-8 locale
(`export LANG=en_US.UTF-8`). Later runs only need `bun run --cwd apps/mobile start`.

`dev:daemon` runs `polaris serve` from source on a throwaway `POLARIS_HOME` with the scripted
bench Harness (the SDK's test Daemon), registers a Workspace and starts two agent sessions. To
use another Daemon, pair an Extension with the `read` Grant on a gateway URL and paste the string
into the app's "Pairing string (development only)" field; it is kept in the Keychain.

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
