/**
 * Fits and seals this Host's slice of the aggregate Live Activity (docs/adr/0088): the slice
 * contract lives in `@polaris/protocol/relay` (live.ts). A slice is sealed to the device like
 * a push, but under info `polaris-live/1`, so it can't be replayed as a notification.
 */
import {
  encodeHostSlice,
  fromBase64Url,
  type HostSlice,
  LIVE_HPKE_INFO,
  MAX_LIVE_PLAINTEXT_BYTES,
  PUSH_ENC_BYTES,
  toBase64Url,
} from "@polaris/protocol/relay";
import { Option } from "effect";
import { pushSuite } from "./seal.ts";

const bytes = (slice: HostSlice) => new TextEncoder().encode(encodeHostSlice(slice)).byteLength;

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
    await sender.seal(new TextEncoder().encode(encodeHostSlice(fitSlice(slice))))
  );

  const out = new Uint8Array(PUSH_ENC_BYTES + sealed.byteLength);
  out.set(new Uint8Array(sender.enc));
  out.set(sealed, PUSH_ENC_BYTES);

  return toBase64Url(out);
};
