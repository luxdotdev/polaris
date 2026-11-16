import { afterAll, beforeAll, expect, test } from "bun:test";
import { STATEMENT_LIFETIME_S } from "@polaris/protocol";
import { Effect } from "effect";
import { type FakeIssuer, startFakeIssuer, type StatementOptions } from "./issuer.testing.ts";
import {
  CLOCK_SKEW_MS,
  isIssuerUrl,
  JWKS_MAX_BYTES,
  JWKS_REFETCH_MS,
  statementVerifier,
} from "./statement.ts";

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
  expect(statement.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000 + CLOCK_SKEW_MS);
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
  ["expired beyond the clock-skew allowance", { ttlS: -(CLOCK_SKEW_MS / 1000) - 5 }, "expired"],
  ["not valid yet (nbf)", { nbfS: CLOCK_SKEW_MS / 1000 + 60 }, "expired"],
  ["issued in the Host's future (iat)", { iatS: CLOCK_SKEW_MS / 1000 + 60 }, "expired"],
  ["signed with HS256 in its header", { alg: "HS256" }, "malformed"],
  ["with no algorithm", { alg: "none" }, "malformed"],
];

test.each([
  ["whose nbf is a few seconds ahead", { nbfS: 5 }],
  ["that expired a few seconds ago", { ttlS: -5 }],
] satisfies ReadonlyArray<readonly [string, StatementOptions]>)(
  "a statement %s is accepted within the clock-skew allowance",
  async (_, options) => {
    const verifier = statementVerifier({ fetch: server.fetch });

    expect(
      await reasonOf(verifier, server.issuer, await server.statement("p1", "k", options))
    ).toBe("accepted");
  }
);

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

/** A `fetch` whose answer is `body` in chunks, counting what the Host pulled. */
const streamed = (body: string, chunk = 4096) => {
  const bytes = new TextEncoder().encode(body);
  let pulled = 0;

  const fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull: (controller) => {
          if (pulled >= bytes.length) {
            controller.close();

            return;
          }

          controller.enqueue(bytes.slice(pulled, pulled + chunk));
          pulled += chunk;
        },
      })
    );

  return { fetch, pulled: () => pulled };
};

test("a JWKS past the byte limit is not read to its end, and vouches for nobody", async () => {
  const jwks = await (await server.fetch(`${server.issuer}/api/auth/jwks`)).text();
  const padded = streamed(`${jwks}${" ".repeat(1024 * 1024)}`);
  const verifier = statementVerifier({ fetch: padded.fetch });

  expect(await reasonOf(verifier, server.issuer, await server.statement("p1", "k"))).toBe(
    "issuer-unreachable"
  );
  expect(padded.pulled()).toBeLessThan(JWKS_MAX_BYTES * 2);
});

test("a JWKS that arrives from another origin vouches for nobody", async () => {
  const verifier = statementVerifier({
    fetch: async (input, init) => {
      const response = await server.fetch(input, init);
      Object.defineProperty(response, "url", { value: "https://evil.test/api/auth/jwks" });

      return response;
    },
  });

  expect(await reasonOf(verifier, server.issuer, await server.statement("p1", "k"))).toBe(
    "issuer-unreachable"
  );
});
