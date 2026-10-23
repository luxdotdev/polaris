import { expect, test } from "bun:test";
import { createHmac, randomBytes } from "node:crypto";
import { Effect } from "effect";
import { startGateway } from "./server.ts";

const challenge = () => randomBytes(32).toString("base64url");

test("identity is a challenge-bound proof, never a reusable GET credential", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = yield* startGateway({ port: 0, recordPath: null });

        if (gateway === null) throw new Error("no gateway");
        const url = `http://127.0.0.1:${gateway.port}/polaris/identity`;
        const get = yield* Effect.promise(() => fetch(url));
        expect(get.status).toBe(405);
        const first = challenge();
        const second = challenge();

        const post = (value: string) =>
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ challenge: value }),
          });

        const response = yield* Effect.promise(() => post(first));
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
        const proof = yield* Effect.promise(() => response.json());

        const expected = (value: string) =>
          createHmac("sha256", Buffer.from(gateway.secret, "base64url"))
            .update(Buffer.from(value, "base64url"))
            .digest("base64url");

        expect(proof).toEqual({ mac: expected(first) });
        expect(proof).not.toEqual({ mac: expected(second) });
        expect(yield* Effect.promise(() => post(second).then((r) => r.json()))).toEqual({
          mac: expected(second),
        });
        // Replaying the proof as a request supplies no challenge and earns no proof.
        expect(
          (yield* Effect.promise(() =>
            fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(proof),
            })
          )).status
        ).toBe(400);
        expect((yield* Effect.promise(() => fetch(url, { method: "OPTIONS" }))).status).toBe(405);
      })
    )
  ));

test("identity rejects malformed, noncanonical, oversized and cross-origin challenges", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const gateway = yield* startGateway({ port: 0, recordPath: null });

        if (gateway === null) throw new Error("no gateway");
        const url = `http://127.0.0.1:${gateway.port}/polaris/identity`;

        for (const value of [
          null,
          1,
          "",
          "a".repeat(42),
          "a".repeat(44),
          "a".repeat(43),
          `${challenge()}=`,
          "+".repeat(43),
          `${challenge()}\n`,
          `${challenge()}\r\n`,
        ]) {
          const response = yield* Effect.promise(() =>
            fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ challenge: value }),
            })
          );

          expect(response.status).toBe(400);
        }

        for (const [body, headers, status] of [
          ["{broken", { "Content-Type": "application/json" }, 400],
          [JSON.stringify({ challenge: challenge() }), { "Content-Type": "text/plain" }, 415],
          [
            JSON.stringify({ challenge: challenge() }),
            { "Content-Type": "application/json", Origin: "https://evil.example" },
            403,
          ],
          [" ".repeat(300), { "Content-Type": "application/json" }, 413],
        ] as const) {
          expect(
            (yield* Effect.promise(() => fetch(url, { method: "POST", headers, body }))).status
          ).toBe(status);
        }
      })
    )
  ));
