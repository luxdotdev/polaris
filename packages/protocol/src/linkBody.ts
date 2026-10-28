/**
 * The `polaris-link:v2` body: the envelope packed as bytes, then base64url, so a link
 * through six Hosts still fits a QR code a phone reads at a glance. Keys travel as raw
 * bytes; a shared Host's relay URL is empty on the wire when it is the link's.
 */
import { Option } from "effect";
import { Base64Url } from "effect/encoding";
import { fromBase64Url } from "./relay/wire.ts";

/** The envelope's fields as plain strings; `linkedDevices.ts` checks them with its Schema. */
export interface RawHost {
  readonly hostId: string;
  readonly hostName: string;
  readonly relayUrl: string;
  readonly hostAddress: string;
  readonly hostNoiseKey: string;
}

export interface RawEnvelope {
  readonly link: RawHost & { readonly secret: string; readonly expiresAt: string };
  readonly hosts: ReadonlyArray<RawHost>;
}

const ADDRESS_BYTES = 16;

const KEY_BYTES = 32;

const MAX_HOSTS = 255;

const utf8 = new TextEncoder();

const fromUtf8 = new TextDecoder("utf-8", { fatal: true });

class Writer {
  readonly parts: Array<number> = [];

  byte(value: number) {
    this.parts.push(value);
  }

  text(value: string) {
    const bytes = utf8.encode(value);

    if (bytes.length > 0xffff) throw new RangeError("A link string field is too long");
    this.parts.push(bytes.length >> 8, bytes.length & 0xff, ...bytes);
  }

  key(value: string, length: number) {
    const bytes = Option.getOrNull(fromBase64Url(value));

    if (bytes?.length !== length) throw new RangeError("A link string key has the wrong length");
    this.parts.push(...bytes);
  }
}

class Reader {
  offset = 0;
  readonly bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new RangeError("Truncated link string");
    const slice = this.bytes.subarray(this.offset, this.offset + length);

    this.offset += length;

    return slice;
  }

  byte(): number {
    return this.take(1)[0] ?? 0;
  }

  text(): string {
    const [high = 0, low = 0] = this.take(2);

    return fromUtf8.decode(this.take((high << 8) | low));
  }

  key(length: number): string {
    return Base64Url.encode(this.take(length));
  }
}

const writeHost = (writer: Writer, host: RawHost, linkRelayUrl: string | null) => {
  writer.text(host.hostId);
  writer.text(host.hostName);
  writer.text(host.relayUrl === linkRelayUrl ? "" : host.relayUrl);
  writer.key(host.hostAddress, ADDRESS_BYTES);
  writer.key(host.hostNoiseKey, KEY_BYTES);
};

const readHost = (reader: Reader, linkRelayUrl: string | null): RawHost => {
  const hostId = reader.text();
  const hostName = reader.text();
  const relayUrl = reader.text();

  return {
    hostId,
    hostName,
    relayUrl: relayUrl === "" && linkRelayUrl !== null ? linkRelayUrl : relayUrl,
    hostAddress: reader.key(ADDRESS_BYTES),
    hostNoiseKey: reader.key(KEY_BYTES),
  };
};

/** Throws a RangeError when a key isn't base64url of its size or there are too many Hosts. */
export const packEnvelope = (envelope: RawEnvelope): string => {
  if (envelope.hosts.length > MAX_HOSTS) throw new RangeError("Too many Hosts for one link");
  const writer = new Writer();

  writeHost(writer, envelope.link, null);
  writer.key(envelope.link.secret, KEY_BYTES);
  writer.text(envelope.link.expiresAt);
  writer.byte(envelope.hosts.length);

  for (const host of envelope.hosts) writeHost(writer, host, envelope.link.relayUrl);

  return Base64Url.encode(Uint8Array.from(writer.parts));
};

/** None when the body isn't base64url, is cut short, or has bytes left over. */
export const unpackEnvelope = (body: string): Option.Option<RawEnvelope> => {
  const bytes = Option.getOrNull(fromBase64Url(body));

  if (bytes === null) return Option.none();

  try {
    const reader = new Reader(bytes);
    const host = readHost(reader, null);
    const secret = reader.key(KEY_BYTES);
    const expiresAt = reader.text();
    const count = reader.byte();
    const hosts = Array.from({ length: count }, () => readHost(reader, host.relayUrl));

    if (reader.offset !== bytes.length) return Option.none();

    return Option.some({ link: { ...host, secret, expiresAt }, hosts });
  } catch {
    return Option.none();
  }
};
