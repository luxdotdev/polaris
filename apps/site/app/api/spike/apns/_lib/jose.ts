// ES256 JWS encoding for APNs provider tokens (ENG-461 spike).
import { Schema } from "effect";

const P256_SIZE = 32;

export const base64url = (bytes: Uint8Array | string): string =>
  Buffer.from(bytes).toString("base64url");

export interface ProviderTokenParts {
  readonly keyId: string;
  readonly teamId: string;
  readonly issuedAt: number;
}

/** The unsigned `header.payload` of an APNs provider token. */
export const signingInput = ({ keyId, teamId, issuedAt }: ProviderTokenParts): string =>
  `${base64url(JSON.stringify({ alg: "ES256", kid: keyId }))}.${base64url(
    JSON.stringify({ iss: teamId, iat: issuedAt })
  )}`;

interface DerInteger {
  readonly value: Uint8Array;
  readonly next: number;
}

const readDerInteger = (der: Uint8Array, at: number): DerInteger => {
  if (der[at] !== 0x02) throw new Error("ECDSA signature: expected an INTEGER");

  const length = der[at + 1] ?? 0;
  const start = at + 2;

  return { value: der.subarray(start, start + length), next: start + length };
};

const toFixed = (integer: Uint8Array): Uint8Array => {
  const trimmed = integer.subarray(Math.max(0, integer.length - P256_SIZE));
  const out = new Uint8Array(P256_SIZE);

  out.set(trimmed, P256_SIZE - trimmed.length);

  return out;
};

export interface JoseSignature {
  readonly raw: Uint8Array;
  readonly encoding: "raw" | "der";
}

/**
 * JWS ES256 needs the raw 64-byte r||s (RFC 7518 §3.4); a KMS may return DER.
 * Returns which encoding it saw so the spike can report it.
 */
export const toJoseSignature = (signature: Uint8Array): JoseSignature => {
  if (signature.length === P256_SIZE * 2) return { raw: signature, encoding: "raw" };

  if (signature[0] !== 0x30) throw new Error(`ECDSA signature: ${signature.length} bytes, not DER`);

  const r = readDerInteger(signature, 2);
  const s = readDerInteger(signature, r.next);
  const raw = new Uint8Array(P256_SIZE * 2);

  raw.set(toFixed(r.value), 0);
  raw.set(toFixed(s.value), P256_SIZE);

  return { raw, encoding: "der" };
};

const JwtFields = Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number]));

export type JwtFields = typeof JwtFields.Type;

export interface JwtParts {
  readonly header: JwtFields;
  readonly claims: JwtFields;
}

const decodeFields = Schema.decodeUnknownSync(Schema.fromJsonString(JwtFields));

/** Decodes a compact JWT's header and claims, never its signature. */
export const decodeParts = (token: string): JwtParts => {
  const [header = "", claims = ""] = token.split(".");
  const decode = (part: string) => decodeFields(Buffer.from(part, "base64url").toString("utf8"));

  return { header: decode(header), claims: decode(claims) };
};
