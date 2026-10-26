/**
 * The pairing string (CONTEXT.md: Pairing): what the user hands an Extension
 * once, as text or a QR code. `polaris-pair:v1:` then base64url of the JSON
 * payload. The Daemon makes it in `extensions.pair`; Extensions decode it here.
 */
import { Option, Schema } from "effect";
import { HostId } from "./ids.ts";

export const PAIRING_STRING_PREFIX = "polaris-pair:v1:";

export const PairingPayload = Schema.Struct({
  hostId: HostId,
  /** The Host's hostname (`HostInfo.hostname`). */
  hostName: Schema.String,
  /** The Remote Access URL (`wss://<host>.<tailnet>.ts.net/polaris/rpc`); null when it is off. */
  url: Schema.NullOr(Schema.String),
  /** The Pairing's token (`pol_ext_…`), sent in `hello` as `extensionToken`. */
  token: Schema.String,
  /** What the user called the Extension when pairing. */
  name: Schema.String,
});

export type PairingPayload = typeof PairingPayload.Type;

const Body = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(PairingPayload))
);

const encodeBody = Schema.encodeSync(Body);

const decodeBody = Schema.decodeUnknownOption(Body);

export const encodePairingString = (payload: PairingPayload): string =>
  `${PAIRING_STRING_PREFIX}${encodeBody(payload)}`;

/** The payload, or none when the text is not a v1 pairing string. Surrounding whitespace is ignored. */
export const decodePairingString = (text: string): Option.Option<PairingPayload> => {
  const trimmed = text.trim();

  return trimmed.startsWith(PAIRING_STRING_PREFIX)
    ? decodeBody(trimmed.slice(PAIRING_STRING_PREFIX.length))
    : Option.none();
};
