import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Exit, Layer, Option } from "effect";
import { backendOf, type Sealer, SecureStorage } from "./index.ts";
import { testSealed, testSealer, withUserData } from "./secure.testing.ts";

const run = <A, E>(layer: Layer.Layer<SecureStorage>, effect: Effect.Effect<A, E, SecureStorage>) =>
  Effect.runPromise(Effect.provide(effect, layer));

/** The tag the effect fails with, or null when it succeeds. */
const failureTag = <A, E extends { readonly _tag: string }>(
  layer: Layer.Layer<SecureStorage>,
  effect: Effect.Effect<A, E, SecureStorage>
) =>
  run(
    layer,
    Effect.match(effect, { onFailure: (error): string | null => error._tag, onSuccess: () => null })
  );

const contract = (name: string, make: (userData: string) => Layer.Layer<SecureStorage>) =>
  describe(`the SecureStorage contract: ${name}`, () => {
    test("set, get and delete by namespaced key", () =>
      withUserData((userData) =>
        run(
          make(userData),
          Effect.gen(function* () {
            const storage = yield* SecureStorage;

            expect(yield* storage.available).toBe(true);
            expect(yield* storage.get("github/tokens/1001")).toEqual(Option.none());

            yield* storage.set("github/tokens/1001", "gho_one");
            yield* storage.set("github/tokens/-1", "gho_enterprise");
            yield* storage.set("languages/client-proof", "proof");

            expect(yield* storage.get("github/tokens/1001")).toEqual(Option.some("gho_one"));
            expect(yield* storage.get("github/tokens/-1")).toEqual(Option.some("gho_enterprise"));

            yield* storage.set("github/tokens/1001", "gho_two");
            expect(yield* storage.get("github/tokens/1001")).toEqual(Option.some("gho_two"));

            yield* storage.delete("github/tokens/1001");
            yield* storage.delete("github/tokens/1001");
            expect(yield* storage.get("github/tokens/1001")).toEqual(Option.none());
            expect(yield* storage.get("languages/client-proof")).toEqual(Option.some("proof"));
          })
        )
      ));

    for (const key of [
      "github",
      "",
      "GitHub/x",
      "github/../escape",
      "github/.hidden",
      "/abs/x",
      "a//b",
    ]) {
      test(`refuses the key ${JSON.stringify(key)}`, () =>
        withUserData(async (userData) => {
          const layer = make(userData);

          expect(
            await failureTag(
              layer,
              SecureStorage.use((s) => s.set(key, "x"))
            )
          ).toBe("SecureStorageError");
          expect(
            await failureTag(
              layer,
              SecureStorage.use((s) => s.get(key))
            )
          ).toBe("SecureStorageError");
          expect(
            await failureTag(
              layer,
              SecureStorage.use((s) => s.delete(key))
            )
          ).toBe("SecureStorageError");
        }));
    }
  });

const files = (userData: string, sealer: Sealer = testSealer()) =>
  SecureStorage.files({ dir: join(userData, "secure"), sealer });

contract("in memory", () => SecureStorage.memory);

contract("sealed files", (userData) => files(userData));

describe("sealed files", () => {
  test("never write a secret in the clear, and keep one file per key", () =>
    withUserData(async (userData) => {
      await run(
        files(userData),
        SecureStorage.use((s) => s.set("github/tokens/1001", "gho_secret"))
      );

      const path = join(userData, "secure", "github", "tokens", "1001.bin");

      expect(readFileSync(path, "utf8")).not.toContain("gho_secret");
      expect(readdirSync(join(userData, "secure", "github", "tokens"))).toEqual(["1001.bin"]);
    }));

  test("survive a restart", () =>
    withUserData(async (userData) => {
      await run(
        files(userData),
        SecureStorage.use((s) => s.set("classifier/openai", "sk-1"))
      );

      expect(
        await run(
          files(userData),
          SecureStorage.use((s) => s.get("classifier/openai"))
        )
      ).toEqual(Option.some("sk-1"));
    }));

  test("a record the OS won't open is an error, never a silent miss", () =>
    withUserData(async (userData) => {
      mkdirSync(join(userData, "secure", "languages"), { recursive: true });
      writeFileSync(join(userData, "secure", "languages", "client-proof.bin"), "planted");

      expect(
        await failureTag(
          files(userData),
          SecureStorage.use((s) => s.get("languages/client-proof"))
        )
      ).toBe("SecureStorageError");
    }));

  test("reseal a record when the OS key rotated", () =>
    withUserData(async (userData) => {
      const seals: Array<string> = [];
      const base = testSealer();

      const rotating: Sealer = {
        ...base,
        seal: (plain) => {
          seals.push(plain);

          return base.seal(plain);
        },
        open: (sealed) => base.open(sealed).then((o) => ({ ...o, shouldReEncrypt: true })),
      };

      await run(
        files(userData, rotating),
        Effect.gen(function* () {
          const storage = yield* SecureStorage;

          yield* storage.set("github/tokens/7", "gho_7");
          expect(yield* storage.get("github/tokens/7")).toEqual(Option.some("gho_7"));
        })
      );

      expect(seals).toEqual(["gho_7", "gho_7"]);
    }));

  test("adopt sealed records from before SecureStorage, once, by moving them", () =>
    withUserData(async (userData) => {
      const legacy = join(userData, "github", "tokens");

      mkdirSync(legacy, { recursive: true });
      writeFileSync(join(legacy, "1001.bin"), testSealed("gho_old"));
      writeFileSync(join(legacy, "-1.bin"), testSealed("gho_ghe"));
      writeFileSync(join(legacy, "notes.txt"), "not a record");

      const layer = SecureStorage.files({
        dir: join(userData, "secure"),
        sealer: testSealer(),
        adopt: [{ from: legacy, prefix: "github/tokens" }],
      });

      await run(
        layer,
        Effect.gen(function* () {
          const storage = yield* SecureStorage;

          expect(yield* storage.get("github/tokens/1001")).toEqual(Option.some("gho_old"));
          expect(yield* storage.get("github/tokens/-1")).toEqual(Option.some("gho_ghe"));
        })
      );

      expect(readdirSync(legacy)).toEqual(["notes.txt"]);

      // A newer record wins over a stale legacy one left behind.
      writeFileSync(join(legacy, "1001.bin"), testSealed("gho_stale"));
      await run(
        layer,
        SecureStorage.use((s) => s.set("github/tokens/1001", "gho_new"))
      );
      expect(
        await run(
          layer,
          SecureStorage.use((s) => s.get("github/tokens/1001"))
        )
      ).toEqual(Option.some("gho_new"));
      expect(existsSync(join(legacy, "1001.bin"))).toBe(false);
    }));
});

describe("refusing a store that can't keep a secret", () => {
  test("Linux's basic_text backend is refused as plaintext; other platforms ignore it", () => {
    const facts = { encryptionAvailable: true, selectedBackend: () => "basic_text" };

    expect(backendOf({ ...facts, platform: "linux" })).toBe("plaintext-backend");
    expect(
      backendOf({ ...facts, platform: "linux", selectedBackend: () => "gnome_libsecret" })
    ).toBe("ok");
    expect(backendOf({ ...facts, platform: "win32" })).toBe("ok");
    expect(backendOf({ ...facts, platform: "darwin" })).toBe("ok");
    expect(backendOf({ ...facts, encryptionAvailable: false, platform: "win32" })).toBe(
      "no-backend"
    );
  });

  for (const [name, make] of [
    [
      "sealed files under basic_text",
      (userData: string) => files(userData, testSealer("plaintext-backend")),
    ],
    ["the unavailable Layer", () => SecureStorage.unavailable("plaintext-backend")],
  ] as const) {
    test(`${name}: reads and writes fail as unavailable, with the reason, and nothing is written`, () =>
      withUserData(async (userData) => {
        const layer = make(userData);

        const exit = await Effect.runPromise(
          Effect.provide(
            Effect.exit(SecureStorage.use((s) => s.set("github/tokens/1", "gho"))),
            layer
          )
        );

        expect(
          await run(
            layer,
            SecureStorage.use((s) => s.available)
          )
        ).toBe(false);
        expect(Exit.isFailure(exit)).toBe(true);
        expect(JSON.stringify(exit)).toContain("plaintext-backend");
        expect(
          await failureTag(
            layer,
            SecureStorage.use((s) => s.get("github/tokens/1"))
          )
        ).toBe("SecureStorageUnavailable");
        expect(existsSync(join(userData, "secure", "github"))).toBe(false);
        await run(
          layer,
          SecureStorage.use((s) => s.delete("github/tokens/1"))
        );
      }));
  }
});
