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

const decodeJwks = Schema.decodeUnknownOption(Jwks);

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

const JWKS_TIMEOUT_MS = 10_000;

interface IssuerKeys {
  readonly keys: ReadonlyArray<{ readonly kid: string | null; readonly key: CryptoKey }>;
  readonly fetchedAt: number;
}

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
  options: { readonly fetch?: Fetch | undefined; readonly now?: (() => number) | undefined } = {}
): StatementVerifier => {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, IssuerKeys>();
  const loading = new Map<string, Promise<IssuerKeys>>();

  const load = async (issuer: string): Promise<IssuerKeys> => {
    const response = await request(`${issuer}/api/auth/jwks`, {
      redirect: "error",
      signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`the JWKS answered ${response.status}`);
    const jwks = Option.getOrThrow(decodeJwks(await response.json()));

    const keys = await Promise.all(
      jwks.keys
        .filter((jwk) => jwk.kty === "OKP" && jwk.crv === "Ed25519" && jwk.x !== undefined)
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

    const loaded = { keys, fetchedAt: now() };
    cache.set(issuer, loaded);

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

  /** The issuer's keys for `kid`; refetched when unknown, at most once per `JWKS_REFETCH_MS`. */
  const keysFor = async (issuer: string, kid: string | null) => {
    const cached = cache.get(issuer);

    if (cached !== undefined) {
      const known = candidates(cached, kid);

      if (known.length > 0 || now() - cached.fetchedAt < JWKS_REFETCH_MS) return known;
    }

    return candidates(await fresh(issuer), kid);
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

    if (claims.exp * 1000 <= at) return "expired";

    return {
      issuer,
      personId: claims.sub,
      noiseKey: claims.cnf.noiseKey,
      expiresAt: Math.min(claims.exp * 1000, at + STATEMENT_LIFETIME_S * 1000),
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
