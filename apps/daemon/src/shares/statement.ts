/**
 * Statements (ADR 0112; apps/accounts/README.md is the contract): an EdDSA JWT an Account
 * Server signs, binding a person to one device's relay Noise key. The Host checks it against
 * the JWKS of the issuer pinned on the Share, fetched over TLS from that issuer and cached.
 */
import {
  type PersonId,
  STATEMENT_LIFETIME_S,
  StatementClaims,
  StatementRejected,
} from "@polaris/protocol";
import { Effect, Option, Predicate, Schema } from "effect";
import { fromIssuer, readCapped } from "./body.ts";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** An issuer the Host asks: an https origin, or http for an Account Server on this machine. */
export const isIssuerUrl = (issuer: string): boolean => {
  if (!URL.canParse(issuer)) return false;
  const url = new URL(issuer);

  if (url.origin !== issuer) return false;

  return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
};

const Header = Schema.Struct({
  alg: Schema.Literal("EdDSA"),
  kid: Schema.optionalKey(Schema.String),
});

const Jwks = Schema.Struct({
  keys: Schema.Array(
    Schema.Struct({
      kty: Schema.String,
      crv: Schema.optionalKey(Schema.String),
      x: Schema.optionalKey(Schema.String),
      kid: Schema.optionalKey(Schema.String),
    })
  ),
});

const decodeHeader = Schema.decodeUnknownOption(Schema.fromJsonString(Header));

const decodeClaims = Schema.decodeUnknownOption(Schema.fromJsonString(StatementClaims));

const decodeJwks = Schema.decodeUnknownOption(Schema.fromJsonString(Jwks));

/** The most a JWKS answer may weigh and hold; an Account Server keeps a handful of keys. */
export const JWKS_MAX_BYTES = 16 * 1024;

const JWKS_MAX_KEYS = 16;

const KEY_FIELD_MAX = 256;

/** How far the issuer's clock and the Host's may differ, for `nbf`, `iat` and `exp` alike. */
export const CLOCK_SKEW_MS = 30_000;

/** A statement the pinned issuer signed and that has not expired. */
export interface VerifiedStatement {
  readonly issuer: string;
  readonly personId: PersonId;
  /** base64url of the device's X25519 static public key. */
  readonly noiseKey: string;
  /** Milliseconds since the epoch; never more than a statement's lifetime ahead. */
  readonly expiresAt: number;
  readonly login: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly commitEmail: string | null;
}

type Reason = StatementRejected["reason"];

/** How long an issuer's JWKS is trusted to be complete: an unknown `kid` refetches after it. */
export const JWKS_REFETCH_MS = 30_000;

/** The longest a fetched JWKS is used before it is fetched again: a statement's lifetime. */
export const JWKS_MAX_AGE_MS = STATEMENT_LIFETIME_S * 1000;

/** Past its max age, while the issuer can't be reached, a JWKS is still used this long. */
export const JWKS_OUTAGE_GRACE_MS = 5 * 60_000;

const JWKS_TIMEOUT_MS = 10_000;

interface IssuerKeys {
  readonly keys: ReadonlyArray<{ readonly kid: string | null; readonly key: CryptoKey }>;
  readonly fetchedAt: number;
  /** When the JWKS must be fetched again; its `Cache-Control` max-age, within bounds. */
  readonly staleAt: number;
}

/** The JWKS's max age: `Cache-Control` within [`JWKS_REFETCH_MS`, `JWKS_MAX_AGE_MS`]. */
export const jwksMaxAge = (cacheControl: string | null): number => {
  const directives = (cacheControl ?? "").toLowerCase();

  if (/\b(no-store|no-cache)\b/.test(directives)) return JWKS_REFETCH_MS;
  const maxAge = /\bmax-age=(\d+)/.exec(directives)?.[1];

  if (maxAge === undefined) return JWKS_MAX_AGE_MS;

  return Math.min(Math.max(Number(maxAge) * 1000, JWKS_REFETCH_MS), JWKS_MAX_AGE_MS);
};

const text = (part: string) => Buffer.from(part, "base64url").toString("utf8");

/** base64url as bytes over their own ArrayBuffer, which WebCrypto takes. */
const bytes = (part: string) => new Uint8Array(Buffer.from(part, "base64url"));

export interface StatementVerifier {
  /** As `verify`, for code outside Effect: the statement, or why it is refused. Never rejects. */
  readonly check: (
    issuer: string,
    jwt: string
  ) => Promise<VerifiedStatement | StatementRejected["reason"]>;
  /** Fails unless the issuer at `issuer` signed `jwt` and it is still valid. */
  readonly verify: (
    issuer: string,
    jwt: string
  ) => Effect.Effect<VerifiedStatement, StatementRejected>;
}

export const statementVerifier = (
  options: {
    readonly fetch?: Fetch | undefined;
    readonly now?: (() => number) | undefined;
    /** For tests: the clock-skew allowance, `CLOCK_SKEW_MS` unless given. */
    readonly skewMs?: number | undefined;
  } = {}
): StatementVerifier => {
  const skew = options.skewMs ?? CLOCK_SKEW_MS;
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, IssuerKeys>();
  const loading = new Map<string, Promise<IssuerKeys>>();
  /** When each issuer's last refetch failed; another waits `JWKS_REFETCH_MS`. */
  const failedAt = new Map<string, number>();

  const load = async (issuer: string): Promise<IssuerKeys> => {
    const response = await request(`${issuer}/api/auth/jwks`, {
      redirect: "error",
      signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
    });

    if (!fromIssuer(response, issuer)) throw new Error("the JWKS came from another origin");

    if (!response.ok) throw new Error(`the JWKS answered ${response.status}`);
    const body = await readCapped(response, JWKS_MAX_BYTES);

    if (body === null) throw new Error("the JWKS is too large");
    const jwks = Option.getOrThrow(decodeJwks(body));

    if (jwks.keys.length > JWKS_MAX_KEYS) throw new Error("the JWKS holds too many keys");

    const keys = await Promise.all(
      jwks.keys
        .filter((jwk) => jwk.kty === "OKP" && jwk.crv === "Ed25519" && jwk.x !== undefined)
        .filter((jwk) => Math.max(jwk.x?.length ?? 0, jwk.kid?.length ?? 0) <= KEY_FIELD_MAX)
        .map(async (jwk) => ({
          kid: jwk.kid ?? null,
          key: await crypto.subtle.importKey(
            "raw",
            bytes(jwk.x ?? ""),
            { name: "Ed25519" },
            false,
            ["verify"]
          ),
        }))
    );

    const fetchedAt = now();

    const loaded = {
      keys,
      fetchedAt,
      staleAt: fetchedAt + jwksMaxAge(response.headers.get("cache-control")),
    };

    cache.set(issuer, loaded);
    failedAt.delete(issuer);

    return loaded;
  };

  /** One fetch per issuer at a time, however many statements wait on it. */
  const fresh = (issuer: string) => {
    const pending = loading.get(issuer) ?? load(issuer).finally(() => loading.delete(issuer));
    loading.set(issuer, pending);

    return pending;
  };

  const candidates = (keys: IssuerKeys, kid: string | null) =>
    keys.keys.filter((entry) => kid === null || entry.kid === kid);

  /** A stale JWKS, while the issuer is unreachable: used within the grace, refused past it. */
  const stale = (issuer: string, kid: string | null) => {
    const cached = cache.get(issuer);

    if (cached === undefined || now() >= cached.staleAt + JWKS_OUTAGE_GRACE_MS)
      throw new Error("the issuer's JWKS can't be fetched");

    return candidates(cached, kid);
  };

  const refetch = async (issuer: string, kid: string | null) => {
    const failed = failedAt.get(issuer);

    if (failed !== undefined && cache.has(issuer) && now() - failed < JWKS_REFETCH_MS)
      return stale(issuer, kid);

    try {
      return candidates(await fresh(issuer), kid);
    } catch {
      failedAt.set(issuer, now());

      return stale(issuer, kid);
    }
  };

  /**
   * The issuer's keys for `kid`: refetched past the JWKS's max age, and for an unknown `kid` at
   * most once per `JWKS_REFETCH_MS`.
   */
  const keysFor = async (issuer: string, kid: string | null) => {
    const cached = cache.get(issuer);
    const at = now();

    if (cached !== undefined && at < cached.staleAt) {
      const known = candidates(cached, kid);

      if (known.length > 0 || at - cached.fetchedAt < JWKS_REFETCH_MS) return known;
    }

    return refetch(issuer, kid);
  };

  const signedBy = async (
    keys: ReadonlyArray<{ readonly key: CryptoKey }>,
    signature: Uint8Array<ArrayBuffer>,
    signed: Uint8Array<ArrayBuffer>
  ) => {
    for (const { key } of keys)
      if (await crypto.subtle.verify({ name: "Ed25519" }, key, signature, signed)) return true;

    return false;
  };

  const check = async (issuer: string, jwt: string): Promise<VerifiedStatement | Reason> => {
    const parts = jwt.split(".");
    const [head, body, signature] = parts;

    if (parts.length !== 3 || head === undefined || body === undefined || signature === undefined)
      return "malformed";
    const header = Option.getOrNull(decodeHeader(text(head)));
    const claims = Option.getOrNull(decodeClaims(text(body)));

    if (header === null || claims === null) return "malformed";

    // Keys are fetched over TLS, and only from the issuer pinned on the Share.
    if (!isIssuerUrl(issuer)) return "issuer-unreachable";

    if (claims.iss !== issuer) return "signature";

    if (claims.aud !== undefined && claims.aud !== issuer) return "signature";
    let keys: Awaited<ReturnType<typeof keysFor>>;

    try {
      keys = await keysFor(issuer, header.kid ?? null);
    } catch {
      return "issuer-unreachable";
    }

    const signed = new TextEncoder().encode(`${head}.${body}`);

    if (!(await signedBy(keys, bytes(signature), signed))) return "signature";
    const at = now();

    // Not valid yet (`nbf`, or an `iat` ahead of the Host) reads as not valid now, like `exp`.
    if (Math.max(claims.nbf ?? 0, claims.iat ?? 0) * 1000 - skew > at) return "expired";

    if (claims.exp * 1000 + skew <= at) return "expired";

    return {
      issuer,
      personId: claims.sub,
      noiseKey: claims.cnf.noiseKey,
      expiresAt: Math.min(claims.exp * 1000 + skew, at + STATEMENT_LIFETIME_S * 1000),
      login: claims.login,
      name: claims.name,
      avatarUrl: claims.avatarUrl,
      commitEmail: claims.commitEmail,
    };
  };

  const settled = (issuer: string, jwt: string) =>
    check(issuer, jwt).catch((): Reason => "malformed");

  return {
    check: settled,
    verify: (issuer, jwt) =>
      Effect.promise(() => settled(issuer, jwt)).pipe(
        Effect.flatMap((result) =>
          Predicate.isString(result)
            ? Effect.fail(new StatementRejected({ reason: result }))
            : Effect.succeed(result)
        )
      ),
  };
};
