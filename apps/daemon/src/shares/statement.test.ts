import { afterAll, beforeAll, expect, test } from "bun:test";
import { STATEMENT_LIFETIME_S } from "@polaris/protocol";
import { Effect } from "effect";
import { type FakeIssuer, startFakeIssuer, type StatementOptions } from "./issuer.testing.ts";
import { isIssuerUrl, JWKS_REFETCH_MS, statementVerifier } from "./statement.ts";

let server: FakeIssuer;

beforeAll(async () => {
  server = await startFakeIssuer();
});

afterAll(() => server.stop());

const reasonOf = (verifier: ReturnType<typeof statementVerifier>, issuer: string, jwt: string) =>
  Effect.runPromise(
    verifier.verify(issuer, jwt).pipe(
      Effect.map(() => "accepted"),
      Effect.catch((error) => Effect.succeed(error.reason))
    )
  );

test("a statement the pinned issuer signed names its person, its device and its expiry", async () => {
  const verifier = statementVerifier({ fetch: server.fetch });
  const before = Date.now();

  const statement = await Effect.runPromise(
    verifier.verify(server.issuer, await server.statement("p1", "device-key", { ttlS: 60 }))
  );

  expect(statement).toMatchObject({ personId: "p1", noiseKey: "device-key", login: "octocat" });
  expect(statement.expiresAt).toBeGreaterThan(before + 58_000);
  expect(statement.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
});

test("a statement never vouches for longer than a statement's lifetime", async () => {
  const verifier = statementVerifier({ fetch: server.fetch });

  const statement = await Effect.runPromise(
    verifier.verify(server.issuer, await server.statement("p1", "k", { ttlS: 30 * 24 * 3600 }))
  );

  expect(statement.expiresAt).toBeLessThanOrEqual(Date.now() + STATEMENT_LIFETIME_S * 1000);
});

const refusals: ReadonlyArray<readonly [string, StatementOptions, string]> = [
  ["signed by a key the issuer does not publish", { forged: true }, "signature"],
  ["issued by another Account Server", { iss: "https://evil.test" }, "signature"],
  ["already expired", { ttlS: -5 }, "expired"],
];

test.each(refusals)("a statement %s is refused", async (_, options, reason) => {
  const verifier = statementVerifier({ fetch: server.fetch });

  expect(await reasonOf(verifier, server.issuer, await server.statement("p1", "k", options))).toBe(
    reason
  );
});

test("text that is no statement is refused as malformed", async () => {
  const verifier = statementVerifier({ fetch: server.fetch });

  expect(await reasonOf(verifier, server.issuer, "not.a.statement")).toBe("malformed");
  expect(await reasonOf(verifier, server.issuer, "")).toBe("malformed");
});

test("an issuer whose keys can't be fetched vouches for nobody", async () => {
  const other = await startFakeIssuer();
  const verifier = statementVerifier({ fetch: other.fetch });
  const statement = await other.statement("p1", "k");
  other.down = true;

  expect(await reasonOf(verifier, other.issuer, statement)).toBe("issuer-unreachable");
  other.stop();
});

test("keys are never fetched from an issuer without TLS", async () => {
  let asked = 0;

  const verifier = statementVerifier({
    fetch: (input, init) => {
      asked++;

      return server.fetch(input, init);
    },
  });

  const statement = await server.statement("p1", "k", { iss: "http://accounts.example" });

  expect(await reasonOf(verifier, "http://accounts.example", statement)).toBe("issuer-unreachable");
  expect(asked).toBe(0);
});

test("a rotated key is found by refetching the JWKS, at most once per interval", async () => {
  const rotating = await startFakeIssuer();
  let now = Date.now();
  const verifier = statementVerifier({ fetch: rotating.fetch, now: () => now });

  expect(await reasonOf(verifier, rotating.issuer, await rotating.statement("p1", "k"))).toBe(
    "accepted"
  );
  await rotating.rotate();
  const rotated = await rotating.statement("p1", "k");

  // Within the interval an unknown `kid` is refused without asking the issuer again.
  expect(await reasonOf(verifier, rotating.issuer, rotated)).toBe("signature");
  expect(rotating.jwksFetches()).toBe(1);

  now += JWKS_REFETCH_MS + 1;
  expect(await reasonOf(verifier, rotating.issuer, rotated)).toBe("accepted");
  expect(rotating.jwksFetches()).toBe(2);
  rotating.stop();
});

test.each([
  ["https://auth.polaris.lux.dev", true],
  ["http://127.0.0.1:3000", true],
  ["http://localhost:3000", true],
  ["http://auth.polaris.lux.dev", false],
  ["https://auth.polaris.lux.dev/", false],
  ["https://auth.polaris.lux.dev/path", false],
  ["not a url", false],
])("issuer %s is one the Host asks: %p", (issuer, allowed) => {
  expect(isIssuerUrl(issuer)).toBe(allowed);
});
