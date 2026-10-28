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
holds the routes for the thread, Review, New agent session and Link screens.

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

## Review

`src/review/` is Paper M5: `ReviewScreen({ hostId, sessionId, turnId?, colourblind?, onBack? })` reviews one agent session's Turn. It reads the Turn's diff (`git.diff`, as a blob), runs or reads its Risk Summary (`review.runRiskSummary`, then `review.watchRiskSummary`), and shows the Polaris summary with its tally, the files ordered by risk (or by path under Files), and findings inline under the line they flag. Accept sends `AcceptTurns` and is paused while a Critical finding is open. Send back sends the user's reply as a feedback Turn, and "Ask {harness} to fix" quotes the flagged lines. A Critical finding can't be hidden: a dismissed one stays listed, and its card stays visible when its file is closed.

The diff renderer is Pierre Diffs' patch parser on Hermes. Metro resolves `@pierre/diffs` to its DOM-free `parsePatchFiles` module only, about 13 KB, without Shiki or the DOM renderer. Rows are drawn by a React Native `FlatList`. There is no syntax colouring or word-level highlighting yet. `colourblind` switches to the `-cvd` diff pair.

The diff bench measures it on a device or simulator. It renders Review over a synthetic 2,000-line Turn and reports parse time and frame intervals on screen (and as `POLARIS_DIFF_BENCH {json}` in the log):

```sh
EXPO_PUBLIC_POLARIS_DIFF_BENCH=auto bunx expo run:ios --configuration Release   # JS-driven scroll at 5,000 pt/s
EXPO_PUBLIC_POLARIS_DIFF_BENCH=manual:2000 …                                    # 15 s of your own swipes
```

Home opens Review (the `review` route) from a session row that reads "Ready to review"; the bench replaces the app's root in `index.ts`.

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
