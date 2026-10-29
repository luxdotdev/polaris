/**
 * One Host's slice of the aggregate Live Activity (docs/adr/0088): what it has working, its
 * newest step and its oldest Needs You, sealed to the device like a push but under info
 * `polaris-live/1`. The Relay merges the latest slice of each Host into one ContentState; the
 * activity's widget extension opens them. Spike (ENG-577): LA1 moves the schema to the protocol.
 */
import { fromBase64Url, PUSH_ENC_BYTES, toBase64Url } from "@polaris/protocol/relay";
import { Option, Schema } from "effect";
import { pushSuite } from "./seal.ts";

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

const encodeSlice = Schema.encodeSync(Schema.fromJsonString(HostSlice));

const TAG_BYTES = 16;

/** A sealed slice's longest base64url form, so six Hosts and `aps` fit APNs' 4 KB. */
export const MAX_LIVE_SLICE_CHARS = 560;

/** Hosts one ContentState carries; past it the Relay keeps those with work or Needs You. */
export const MAX_LIVE_HOSTS = 6;

export const MAX_LIVE_PLAINTEXT_BYTES =
  Math.floor((MAX_LIVE_SLICE_CHARS * 3) / 4) - PUSH_ENC_BYTES - TAG_BYTES;

const bytes = (slice: HostSlice) => new TextEncoder().encode(encodeSlice(slice)).byteLength;

const cut = (text: string, points: number) => {
  const chars = Array.from(text);

  return chars.length <= points ? text : `${chars.slice(0, Math.max(0, points - 1)).join("")}…`;
};

interface Field {
  readonly get: (slice: HostSlice) => string;
  readonly set: (slice: HostSlice, text: string) => HostSlice;
}

const lineField = (part: "step" | "need", key: "line" | "session"): Field => ({
  get: (slice) => slice[part]?.[key] ?? "",
  set: (slice, text) => {
    const line = slice[part];

    return line === null ? slice : { ...slice, [part]: { ...line, [key]: text } };
  },
});

/** Cut first to last: the tool lines, then the session titles, then the Host's name. */
const FIELDS: ReadonlyArray<Field> = [
  lineField("step", "line"),
  lineField("need", "line"),
  lineField("step", "session"),
  lineField("need", "session"),
  { get: (slice) => slice.host, set: (slice, host) => ({ ...slice, host }) },
];

const fitField = (slice: HostSlice, field: Field) => {
  const text = field.get(slice);
  let low = 0;
  let high = Array.from(text).length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);

    if (bytes(field.set(slice, cut(text, middle))) <= MAX_LIVE_PLAINTEXT_BYTES) low = middle;
    else high = middle - 1;
  }

  return field.set(slice, cut(text, low));
};

/** `slice` with its fields cut, in FIELDS' order, until its sealed form fits. */
export const fitSlice = (slice: HostSlice): HostSlice => {
  let fitted = slice;

  for (const field of FIELDS) {
    if (bytes(fitted) <= MAX_LIVE_PLAINTEXT_BYTES) return fitted;
    fitted = fitField(fitted, field);
  }

  return fitted;
};

const info = new TextEncoder().encode(LIVE_HPKE_INFO);

/** `slice`, fitted, sealed to `pushKey` (uncompressed P-256, base64url). */
export const sealSlice = async (pushKey: string, slice: HostSlice): Promise<string> => {
  const key = Option.getOrThrow(fromBase64Url(pushKey));
  const recipientPublicKey = await pushSuite.kem.deserializePublicKey(new Uint8Array(key));
  const sender = await pushSuite.createSenderContext({ recipientPublicKey, info });

  const sealed = new Uint8Array(
    await sender.seal(new TextEncoder().encode(encodeSlice(fitSlice(slice))))
  );

  const out = new Uint8Array(PUSH_ENC_BYTES + sealed.byteLength);
  out.set(new Uint8Array(sender.enc));
  out.set(sealed, PUSH_ENC_BYTES);

  return toBase64Url(out);
};

/** The Live Activity's ContentState: each Host's sealed slice, ordered by Host relay address. */
export interface LiveContentState {
  readonly v: 1;
  readonly slices: ReadonlyArray<string>;
}

export interface LiveActivityPush {
  readonly event: "update" | "end";
  /** Unix seconds; ActivityKit drops an update older than the one it shows. */
  readonly timestamp: number;
  readonly state: LiveContentState;
  /** A Needs You takeover lights the screen; routine updates don't. */
  readonly alert: boolean;
}

interface LiveAps {
  timestamp: number;
  event: LiveActivityPush["event"];
  "content-state": LiveContentState;
  "stale-date": number;
  "dismissal-date"?: number;
  alert?: { title: string; body: string };
  sound?: string;
}

/**
 * The APNs body for `apns-push-type: liveactivity` on topic `<bundle>.push-type.liveactivity`.
 * The alert is generic: the slices carry everything the user reads.
 */
export const liveActivityBody = (push: LiveActivityPush) => {
  const aps: LiveAps = {
    timestamp: push.timestamp,
    event: push.event,
    "content-state": push.state,
    "stale-date": push.timestamp + 15 * 60,
  };

  if (push.event === "end") aps["dismissal-date"] = push.timestamp + 60;

  if (push.alert) {
    aps.alert = { title: "Polaris", body: "An agent session needs you." };
    aps.sound = "default";
  }

  return JSON.stringify({ aps });
};
