/**
 * Pairing strings: what `polaris pair` and Settings → Extensions hand an
 * Extension. `polaris-pair:v1:` then base64url of JSON naming the Host, how to
 * reach it (`url`, or null for the local Daemon's socket), the token and the name.
 */
import { Effect, Schema } from "effect";

export const PAIRING_PREFIX = "polaris-pair:v1:";

export const PairingFields = Schema.Struct({
  hostId: Schema.String,
  hostName: Schema.String,
  /** The gateway (`ws://…` or `wss://…/polaris/rpc`); null for the local Daemon's socket. */
  url: Schema.NullOr(Schema.String),
  /** The Pairing's token (`pol_ext_…`), presented in `hello`. */
  token: Schema.String,
  /** What the user called the Extension when pairing it. */
  name: Schema.String,
});

/** One parsed pairing string. Several of them make an SDK client's Hosts. */
export type ParsedPairing = typeof PairingFields.Type;

/** A pairing string that can't be read; `reason` says what is wrong with it. */
export class InvalidPairing extends Schema.TaggedError<InvalidPairing>()("InvalidPairing", {
  reason: Schema.String,
}) {
  override get message(): string {
    return `Not a Polaris pairing: ${this.reason}`;
  }
}

const decodeFields = Schema.decodeUnknownEffect(Schema.fromJsonString(PairingFields));

const base64UrlToText = (encoded: string): string | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return null;
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);

  try {
    const binary = atob(padded);

    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0))
    );
  } catch {
    return null;
  }
};

const validUrl = (url: string): boolean => {
  try {
    const protocol = new URL(url).protocol;

    return protocol === "ws:" || protocol === "wss:";
  } catch {
    return false;
  }
};

/** Reads a pairing string; surrounding whitespace (from a paste) is ignored. */
export const decodePairing = Effect.fn("decodePairing")(function* (text: string) {
  const trimmed = text.trim();

  if (!trimmed.startsWith(PAIRING_PREFIX))
    return yield* new InvalidPairing({ reason: `it does not start with ${PAIRING_PREFIX}` });
  const json = base64UrlToText(trimmed.slice(PAIRING_PREFIX.length));

  if (json === null) return yield* new InvalidPairing({ reason: "it is not base64url" });

  const fields = yield* decodeFields(json).pipe(
    Effect.mapError(() => new InvalidPairing({ reason: "its fields are missing or malformed" }))
  );

  if (fields.url !== null && !validUrl(fields.url))
    return yield* new InvalidPairing({ reason: `its url is not ws:// or wss:// (${fields.url})` });

  return fields;
});

/** `decodePairing` for code without Effect: throws `InvalidPairing`. */
export const parsePairing = (text: string): ParsedPairing => Effect.runSync(decodePairing(text));

/** Writes a pairing string, as the Daemon does; for tests and tools that mint their own. */
export const encodePairing = (pairing: ParsedPairing): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(pairing));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

  return PAIRING_PREFIX + btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
