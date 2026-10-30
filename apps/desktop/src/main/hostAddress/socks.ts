/**
 * The SOCKS5 handshake (RFC 1928) as Chromium speaks it to a `socks5://` proxy: no
 * authentication, then one CONNECT whose target is a domain name, sent unresolved, or an IP
 * literal. Parsers take everything received so far and say whether they need more bytes.
 */
import { Data } from "effect";

export const SOCKS_VERSION = 5;

const NO_AUTHENTICATION = 0x00;

const NO_ACCEPTABLE_METHOD = 0xff;

const CONNECT = 0x01;

const ATYP_IPV4 = 0x01;

const ATYP_DOMAIN = 0x03;

const ATYP_IPV6 = 0x04;

/** RFC 1928 reply codes. */
export const SocksReply = {
  succeeded: 0x00,
  generalFailure: 0x01,
  notAllowed: 0x02,
  networkUnreachable: 0x03,
  hostUnreachable: 0x04,
  connectionRefused: 0x05,
  ttlExpired: 0x06,
  commandNotSupported: 0x07,
  addressTypeNotSupported: 0x08,
} as const;

export type SocksReply = (typeof SocksReply)[keyof typeof SocksReply];

/** A CONNECT target: a domain name exactly as sent, or an IP literal in its canonical text. */
export type SocksTarget = Data.TaggedEnum<{
  Domain: { readonly hostname: string; readonly port: number };
  Ip: { readonly address: string; readonly port: number };
}>;

export const SocksTarget = Data.taggedEnum<SocksTarget>();

/**
 * `Invalid` carries the reply to send before closing, or null when the peer isn't speaking
 * SOCKS5 at all and gets no reply.
 */
export type Parsed<A> = Data.TaggedEnum<{
  NeedMore: Record<never, never>;
  Done: { readonly value: A; readonly rest: Uint8Array };
  Invalid: { readonly reply: SocksReply | null };
}>;

interface ParsedDefinition extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: Parsed<this["A"]>;
}

export const Parsed = Data.taggedEnum<ParsedDefinition>();

/** The client's method list; `value` is whether it offers no authentication. */
export const parseGreeting = (bytes: Uint8Array): Parsed<boolean> => {
  if (bytes.length < 2) return Parsed.NeedMore();

  if (bytes[0] !== SOCKS_VERSION) return Parsed.Invalid({ reply: null });
  const end = 2 + bytes[1]!;

  if (bytes.length < end) return Parsed.NeedMore();

  return Parsed.Done({
    value: bytes.subarray(2, end).includes(NO_AUTHENTICATION),
    rest: bytes.subarray(end),
  });
};

export const greetingReply = (acceptable: boolean): Uint8Array =>
  Uint8Array.of(SOCKS_VERSION, acceptable ? NO_AUTHENTICATION : NO_ACCEPTABLE_METHOD);

const ipv6Text = (bytes: Uint8Array): string => {
  const groups: Array<string> = [];

  for (let i = 0; i < 16; i += 2) groups.push(((bytes[i]! << 8) | bytes[i + 1]!).toString(16));

  // The URL parser writes the canonical (RFC 5952) form, as Chromium does in its own URLs.
  return new URL(`http://[${groups.join(":")}]/`).hostname.slice(1, -1);
};

/** A printable ASCII name; Chromium sends IDNs as punycode. */
const domainText = (bytes: Uint8Array): string | null => {
  if (bytes.length === 0 || bytes.some((byte) => byte <= 0x20 || byte >= 0x7f)) return null;

  return String.fromCharCode(...bytes);
};

const targetLength = (bytes: Uint8Array): number | null => {
  switch (bytes[3]) {
    case ATYP_IPV4:
      return 4;
    case ATYP_IPV6:
      return 16;
    case ATYP_DOMAIN:
      return bytes.length < 5 ? -1 : 1 + bytes[4]!;
    default:
      return null;
  }
};

const readTarget = (bytes: Uint8Array, port: number): SocksTarget | null => {
  const atyp = bytes[3];

  if (atyp === ATYP_IPV4) return SocksTarget.Ip({ address: bytes.subarray(4, 8).join("."), port });

  if (atyp === ATYP_IPV6) return SocksTarget.Ip({ address: ipv6Text(bytes.subarray(4, 20)), port });
  const hostname = domainText(bytes.subarray(5, 5 + bytes[4]!));

  return hostname === null ? null : SocksTarget.Domain({ hostname, port });
};

/** The request after the greeting: only CONNECT, to a non-zero port. */
export const parseRequest = (bytes: Uint8Array): Parsed<SocksTarget> => {
  if (bytes.length < 4) return Parsed.NeedMore();

  if (bytes[0] !== SOCKS_VERSION) return Parsed.Invalid({ reply: null });

  if (bytes[1] !== CONNECT) return Parsed.Invalid({ reply: SocksReply.commandNotSupported });
  const length = targetLength(bytes);

  if (length === null) return Parsed.Invalid({ reply: SocksReply.addressTypeNotSupported });

  if (length === -1) return Parsed.NeedMore();
  const end = 4 + length + 2;

  if (bytes.length < end) return Parsed.NeedMore();
  const port = (bytes[end - 2]! << 8) | bytes[end - 1]!;
  const target = port === 0 ? null : readTarget(bytes, port);

  if (target === null) return Parsed.Invalid({ reply: SocksReply.notAllowed });

  return Parsed.Done({ value: target, rest: bytes.subarray(end) });
};

/** The reply to a CONNECT; the bound address is all zeros, which Chromium ignores. */
export const requestReply = (reply: SocksReply): Uint8Array =>
  Uint8Array.of(SOCKS_VERSION, reply, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0);
