---
status: accepted
amends: ADR 0080
---

# The Live Activity is pushed in sealed Host slices

## Context

The Mobile App's one aggregate Live Activity (ENG-577) shows every followed Host: how many
agent sessions are working, for how long, and the newest step's session title and tool line.
When something needs the user, it switches to a Needs You takeover with Approve, Always here
and Deny. It has to stay current while the app is suspended. Three constraints shape it:

- **Who knows what.** The activity combines several Hosts, but each Daemon knows only itself.
  The Relay connects them all to the phone, but it can't read anything (ADR 0080).
- **What can update a Live Activity.** The app can, but only while it runs. A suspended app gets
  no runtime for this: background refresh is rare and silent pushes are throttled to a few an
  hour. The Notification Service Extension runs only for a visible alert, so it can't drive a
  steady "working" display. An APNs push of type `liveactivity` updates the activity with no app
  code running at all: the system decodes `content-state` and the widget extension draws it.
- **Privacy.** The relay and the push service never see content (`apps/daemon/src/push/README.md`,
  Threat model). A plaintext `content-state` would hand them session titles and tool lines.

## Decision

**Liveactivity pushes carry sealed slices, one per Host. The Relay merges them; the widget
extension opens them.**

- **Slices.** Each Daemon describes only itself in a `HostSlice` (`apps/daemon/src/push/live.ts`):
  `{ v: 1, hostId, host, seq, working, since, step, need, needs }`.
  - `since` is when the longest-running working Turn started, in Unix seconds.
  - `step` is the newest tool step: `{ at, sessionId, session, line }`.
  - `need` is the oldest open approval or question: `step`'s fields plus `requestId` and `kind`.
    `needs` is how many requests are open.

  The Daemon seals the slice to the device's existing push key with the push suite under info
  `polaris-live/1`, so a slice can't be replayed as a notification. A sealed slice is at most
  560 base64url characters; lines, then session titles, then the Host's name are cut to fit.
- **ContentState** is `{ v: 1, slices: [sealed…] }`, ordered by Host relay address. There is no
  activity-level attribute: the one activity always means "every followed Host".
  `PolarisActivityAttributes` is defined identically in `targets/widgets` and
  `modules/polaris-live-activity`, because APNs' `attributes-type` names it.
- **Merging.** Each Daemon sends its new slice to the Relay, never to APNs directly. The Relay
  keeps the latest slice per (activity token, Host) in memory and treats them as opaque. A
  Host's socket is ordered, so the latest to arrive is that Host's newest; `seq` lets the
  extension tell too. It then sends one merged push. Routine updates are coalesced to at most one every 5 s per token at `apns-priority: 5`.
  A slice that opens a Needs You goes out at once at priority 10 with a generic alert ("An agent
  session needs you."). Past six Hosts (4 KB), the Relay keeps those with work or Needs You. A
  Host's slice is dropped when the device stops ticketing that Host. If the Relay restarts, the
  slices are lost; each Daemon sends its slice again when it reconnects.
- **Tokens.** The app starts the activity with `pushType: .token`. It registers the activity's
  update token with each linked Host as it does its APNs token, with a ticket per Host (a
  `devices.registerLiveActivity { token, ticket }` beside `registerPush`). The Relay checks that
  ticket on every slice, so a Host can update only an activity the device gave it. The push
  service sends `apns-push-type: liveactivity` on topic
  `dev.lux.polaris.mobile.push-type.liveactivity` with the same APNs key; no new Apple
  capability is needed, only `NSSupportsLiveActivities`. The body is built by
  `liveActivityBody`: `timestamp`, `event`, `content-state`, a `stale-date` 15 minutes out, and
  the alert for a takeover.
- **App-driven updates** apply only while the app is in front. The app has every Host's feed
  there, so it builds the same ContentState and calls `update` with a timestamp. ActivityKit
  keeps whichever of the app's update and the pushed one is newer.
- **Drawing.** The widget extension opens each slice with the push key from the shared Keychain
  group, which it now joins. It shows the sum of `working`, a timer from the earliest `since`
  (no update needed for it to tick), the newest `step`, and the oldest `need`. A slice it can't
  open is counted and the activity says "Open Polaris to see every host". The Live Activity
  lives in the existing widgets extension: `@bacons/apple-targets` 5.0.0 keeps only one
  widget-type target, and one extension needs no second App ID.

## Consequences

- The relay and the push service still see no content. They now also see how often each
  followed Host's state changes, at most once every 5 s per Host.
- The Relay holds a little per-device state, in memory only. It is the only place the Hosts
  meet, so merging can't move to a Daemon.
- Starting the activity while the app is suspended (push-to-start, iOS 17.2+) needs the start
  token on every Host and someone to decide that a start is due. It is left to a follow-up. Until
  then the app starts the activity when it comes to the front with anything working, and ends it
  (or a push with `event: end` does) once every Host has been idle a while.
- The spike proved its parts on the iOS 27.0 simulator with app-driven updates
  (`-PolarisLiveActivityProbe`, Debug only). The activity starts, APNs issues it an update
  token, and the widget extension opens both Hosts' slices from the shared Keychain and folds
  them on every update, through to the Needs You takeover. A slice sealed by `live.ts` opens
  with the extension's Swift. `simctl push` can't send liveactivity pushes and the APNs keys live
  only in Vercel KMS, so real delivery is proven under ENG-583.
