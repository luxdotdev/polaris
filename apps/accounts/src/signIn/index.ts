import { and, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";
import { InvalidGrant } from "../api/definition.ts";
import type { Database } from "../db/index.ts";
import { signIn } from "../db/schema.ts";
import { Accounts, store } from "../server/services.ts";

/** How long a browser has to finish a sign-in it started. */
export const SIGN_IN_TTL_MS = 10 * 60 * 1000;

/** How long a device has to trade its authorization code (RFC 8252's single-use code). */
export const CODE_TTL_MS = 60 * 1000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Where a device may receive its authorization code: a loopback port, or the Mobile App's scheme. */
export const isDeviceRedirect = (raw: string | null) => {
  if (raw === null) return false;

  try {
    const url = new URL(raw);

    if (url.protocol === "polaris:") return true;

    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
};

/** An S256 `code_challenge`: base64url SHA-256, 43 characters. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** RFC 7636's `code_verifier` alphabet and length. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

const randomToken = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest();

const hashOf = (secret: string) => sha256(secret).toString("hex");

/** The S256 challenge for `verifier`, as a device computes it. */
export const challengeOf = (verifier: string) => sha256(verifier).toString("base64url");

export interface SignInRequest {
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}

/** Reads `/sign-in`'s query; undefined unless it names a device redirect, a state and an S256 challenge. */
export const signInRequestOf = (query: URLSearchParams): SignInRequest | undefined => {
  const redirectUri = query.get("redirect_uri");
  const state = query.get("state") ?? "";
  const codeChallenge = query.get("code_challenge") ?? "";

  if (redirectUri === null || !isDeviceRedirect(redirectUri)) return undefined;

  if (state === "" || state.length > 512) return undefined;

  if (query.get("code_challenge_method") !== "S256" || !CHALLENGE.test(codeChallenge))
    return undefined;

  return { redirectUri, state, codeChallenge };
};

/** Records a pending sign-in; the browser holds `browserSecret` in a cookie to finish it. */
export const startPending = async (db: Database, request: SignInRequest) => {
  const id = randomToken();
  const browserSecret = randomToken();
  // Sign-ins nobody finished or traded go here, so the table stays small without a timer.
  await db.delete(signIn).where(sql`${signIn.expiresAt} < now() - interval '1 hour'`);
  await db.insert(signIn).values({
    id,
    browserHash: hashOf(browserSecret),
    codeChallenge: request.codeChallenge,
    state: request.state,
    redirectUri: request.redirectUri,
    expiresAt: new Date(Date.now() + SIGN_IN_TTL_MS),
  });

  return { id, browserSecret };
};

/**
 * Finishes the pending sign-in `id` for the browser holding `browserSecret`, once, as the person
 * GitHub just signed in: their browser session must be newer than the pending sign-in.
 */
export const finishPending = async (
  db: Database,
  pending: { readonly id: string; readonly browserSecret: string },
  person: { readonly userId: string; readonly sessionCreatedAt: Date }
) => {
  const code = randomToken();

  const [row] = await db
    .update(signIn)
    .set({
      userId: person.userId,
      codeHash: hashOf(code),
      codeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
    })
    .where(
      and(
        eq(signIn.id, pending.id),
        eq(signIn.browserHash, hashOf(pending.browserSecret)),
        isNull(signIn.codeHash),
        gt(signIn.expiresAt, sql`now()`),
        // A session from before this sign-in started means GitHub wasn't asked for this one.
        gte(sql`${person.sessionCreatedAt.toISOString()}::timestamptz`, signIn.createdAt)
      )
    )
    .returning({ redirectUri: signIn.redirectUri, state: signIn.state });

  return row === undefined ? undefined : { ...row, code };
};

/** `POST /v1/sign-in/token`: trades a code once, with its verifier, for a session token. */
export const exchangeCode = Effect.fn("exchangeCode")(function* (
  code: string,
  codeVerifier: string
) {
  const { db, auth } = yield* Accounts;

  // Deleting it first makes the code single-use, even when the verifier turns out wrong.
  const [row] = yield* store(() =>
    db
      .delete(signIn)
      .where(and(eq(signIn.codeHash, hashOf(code)), gt(signIn.codeExpiresAt, sql`now()`)))
      .returning({ userId: signIn.userId, codeChallenge: signIn.codeChallenge })
  );

  const verified =
    row?.userId != null &&
    VERIFIER.test(codeVerifier) &&
    challengeOf(codeVerifier) === row.codeChallenge;

  if (!verified || row?.userId == null) return yield* new InvalidGrant({ error: "invalid_grant" });
  const userId = row.userId;
  const context = yield* store(async () => auth.$context);
  const session = yield* store(() => context.internalAdapter.createSession(userId));

  return { token: session.token };
});
