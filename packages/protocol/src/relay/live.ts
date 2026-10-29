/**
 * The aggregate Live Activity (docs/adr/0088). Each Daemon seals its own `HostSlice` to the
 * device's push key under info `polaris-live/1` and sends it in a `live` frame; the relay
 * merges the latest slice of each Host into one `LiveContentState`; the push service sends it
 * as an `apns-push-type: liveactivity` push; the widget extension opens the slices.
 */
import { Schema } from "effect";
import { PUSH_ENC_BYTES, PushKey } from "./push.ts";
import { ApnsToken, MAX_LIVE_SLICE_CHARS, PushEnvironment, PushTicket } from "./wire.ts";

export const LIVE_HPKE_INFO = "polaris-live/1";

/** A tool step or a request, as the activity shows it: which session, and its one line. */
export const LiveLine = Schema.Struct({
  /** Unix seconds. */
  at: Schema.Number,
  sessionId: Schema.String,
  session: Schema.String,
  line: Schema.String,
});

export type LiveLine = typeof LiveLine.Type;

export const LiveNeed = Schema.Struct({
  ...LiveLine.fields,
  requestId: Schema.String,
  kind: Schema.Literals(["approval", "question"]),
});

export type LiveNeed = typeof LiveNeed.Type;

/** One Host's part of the activity: what it has working, its newest step, its oldest Needs You. */
export const HostSlice = Schema.Struct({
  v: Schema.Literal(1),
  hostId: Schema.String,
  host: Schema.String,
  /** Raises with every slice this Host sends, so a stale one never replaces a newer. */
  seq: Schema.Number,
  working: Schema.Number,
  /** Unix seconds the longest-running working Turn started; the activity's timer counts from it. */
  since: Schema.NullOr(Schema.Number),
  step: Schema.NullOr(LiveLine),
  /** The oldest open request, and how many are open. */
  need: Schema.NullOr(LiveNeed),
  needs: Schema.Number,
});

export type HostSlice = typeof HostSlice.Type;

export const encodeHostSlice = Schema.encodeSync(Schema.fromJsonString(HostSlice));

export const decodeHostSlice = Schema.decodeUnknownOption(Schema.fromJsonString(HostSlice));

/** Hosts one ContentState carries; past it the relay keeps those with work or Needs You. */
export const MAX_LIVE_HOSTS = 6;

const TAG_BYTES = 16;

/** The longest slice JSON, in UTF-8 bytes, whose sealed form fits `MAX_LIVE_SLICE_CHARS`. */
export const MAX_LIVE_PLAINTEXT_BYTES =
  Math.floor((MAX_LIVE_SLICE_CHARS * 3) / 4) - PUSH_ENC_BYTES - TAG_BYTES;

/** The activity's ContentState: each Host's sealed slice, ordered by Host relay address. */
export const LiveContentState = Schema.Struct({
  v: Schema.Literal(1),
  slices: Schema.Array(
    Schema.String.check(
      Schema.isPattern(/^[A-Za-z0-9_-]+$/),
      Schema.isMaxLength(MAX_LIVE_SLICE_CHARS)
    )
  ).check(Schema.isMaxLength(MAX_LIVE_HOSTS)),
});

export type LiveContentState = typeof LiveContentState.Type;

/**
 * What a device registers with each Host it links, over its end-to-end session
 * (`devices.registerLiveActivity`). A new registration replaces the last.
 */
export const LiveActivityRegistration = Schema.Struct({
  /** The activity's update token (`Activity.pushTokenUpdates`), lowercase hex. */
  token: ApnsToken,
  environment: PushEnvironment,
  /** The key slices are sealed to: the Notification Service Extension's push key. */
  pushKey: PushKey,
  /** `signLiveTicket` for this Host's relay address, environment and token. */
  ticket: PushTicket,
});

export type LiveActivityRegistration = typeof LiveActivityRegistration.Type;

/** One merged update for the push service to send. */
export const LiveActivityPush = Schema.Struct({
  event: Schema.Literals(["update", "end"]),
  /** Unix seconds; ActivityKit drops an update older than the one it shows. */
  timestamp: Schema.Int,
  state: LiveContentState,
  /** A Needs You takeover: priority 10 with a generic alert. Routine updates go at priority 5. */
  alert: Schema.Boolean,
});

export type LiveActivityPush = typeof LiveActivityPush.Type;

/** What the relay asks the push service (`/api/push`) to deliver to an activity. */
export const LivePushRequest = Schema.Struct({
  token: ApnsToken,
  environment: PushEnvironment,
  live: LiveActivityPush,
});

export type LivePushRequest = typeof LivePushRequest.Type;

/** The topic suffix APNs wants for `apns-push-type: liveactivity`. */
export const LIVE_TOPIC_SUFFIX = ".push-type.liveactivity";

/** How long an update stays fresh before the activity shows itself stale. */
export const LIVE_STALE_S = 15 * 60;

/** The alert a Needs You takeover shows; generic, since the slices carry what the user reads. */
export const LIVE_ALERT = { title: "Polaris", body: "An agent session needs you." } as const;

interface LiveAps {
  timestamp: number;
  event: LiveActivityPush["event"];
  "content-state": LiveContentState;
  "stale-date": number;
  "dismissal-date"?: number;
  alert?: { title: string; body: string };
  sound?: string;
}

/** The APNs body for `apns-push-type: liveactivity` on topic `<bundle>.push-type.liveactivity`. */
export const liveActivityBody = (push: LiveActivityPush): string => {
  const aps: LiveAps = {
    timestamp: push.timestamp,
    event: push.event,
    "content-state": push.state,
    "stale-date": push.timestamp + LIVE_STALE_S,
  };

  if (push.event === "end") aps["dismissal-date"] = push.timestamp + 60;

  if (push.alert) {
    aps.alert = { ...LIVE_ALERT };
    aps.sound = "default";
  }

  return JSON.stringify({ aps });
};
