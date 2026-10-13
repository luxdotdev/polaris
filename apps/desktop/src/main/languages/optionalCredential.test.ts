import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Layer, Option, Redacted } from "effect";
import { type Sealer, SecureStorage } from "../secure/index.ts";
import { testSealer, withUserData } from "../secure/secure.testing.ts";
import { LEGACY_PROOF_FILE, loadLanguageCredential } from "./credential.ts";
import { LANGUAGE_PROOF_KEY, optionalLanguageCredential } from "./optionalCredential.ts";

const WARNING = "Language identity unavailable: private credential could not be loaded";

const files = (userData: string, sealer: Sealer = testSealer()) =>
  SecureStorage.files({ dir: join(userData, "secure"), sealer });

/** What Main's startup does: the options it spreads into the Client runtime, and its warnings. */
const start = async (
  layer: Layer.Layer<SecureStorage>,
  userData: string,
  platform: NodeJS.Platform
) => {
  const warnings: Array<string> = [];
  const input = { legacyDirectory: join(userData, "language-private"), platform };

  const options = await Effect.runPromise(
    Effect.provide(
      optionalLanguageCredential(input, (message) => warnings.push(message)),
      layer
    )
  );

  return { proof: "clientIdentity" in options ? options.clientIdentity.proof : null, warnings };
};

const stored = (layer: Layer.Layer<SecureStorage>) =>
  Effect.runPromise(
    Effect.provide(
      SecureStorage.use((s) => s.get(LANGUAGE_PROOF_KEY)),
      layer
    )
  );

const valueOf = (proof: Redacted.Redacted<string> | null) =>
  proof === null ? null : Redacted.value(proof);

describe("language identity on Windows (bug B5)", () => {
  test("the proof lives in SecureStorage (DPAPI) and survives a restart", () =>
    withUserData(async (userData) => {
      const first = await start(files(userData), userData, "win32");
      const second = await start(files(userData), userData, "win32");

      expect(first.warnings).toEqual([]);
      expect(valueOf(first.proof)).toMatch(/^[a-f0-9]{64}$/);
      expect(valueOf(second.proof)).toBe(valueOf(first.proof));
      expect(JSON.stringify(first.proof)).toBe('"<redacted:language identity>"');
      expect(existsSync(join(userData, "language-private"))).toBe(false);

      const sealed = readFileSync(
        join(userData, "secure", "languages", "client-proof.bin"),
        "utf8"
      );

      expect(sealed).not.toContain(valueOf(first.proof) ?? "");
    }));

  test("a POSIX proof file copied over from another machine is ignored, never read", () =>
    withUserData(async (userData) => {
      const legacy = join(userData, "language-private");

      mkdirSync(legacy);
      writeFileSync(join(legacy, LEGACY_PROOF_FILE), `${"a".repeat(64)}\n`);

      const { proof, warnings } = await start(SecureStorage.memory, userData, "win32");

      expect(warnings).toEqual([]);
      expect(valueOf(proof)).not.toBe("a".repeat(64));
    }));

  test("with no secret store, identity is off and says so, without a fallback file", () =>
    withUserData(async (userData) => {
      const { proof, warnings } = await start(
        SecureStorage.unavailable("no-backend"),
        userData,
        "win32"
      );

      expect(proof).toBeNull();
      expect(warnings).toEqual([WARNING]);
      expect(existsSync(join(userData, "language-private"))).toBe(false);
    }));
});

describe("language identity on macOS and Linux", () => {
  for (const platform of ["darwin", "linux"] as const) {
    test(`${platform}: the proof lives in SecureStorage and is stable`, () =>
      withUserData(async (userData) => {
        const layer = files(userData);
        const first = await start(layer, userData, platform);
        const second = await start(layer, userData, platform);

        expect(first.warnings).toEqual([]);
        expect(valueOf(second.proof)).toBe(valueOf(first.proof));
        expect(existsSync(join(userData, "language-private"))).toBe(false);
      }));
  }

  test("an existing POSIX proof is adopted unchanged, so the identity carries over", () =>
    withUserData(async (userData) => {
      const legacy = join(userData, "language-private");
      const before = Redacted.value(loadLanguageCredential(legacy));
      const layer = files(userData);
      const { proof, warnings } = await start(layer, userData, "darwin");

      expect(warnings).toEqual([]);
      expect(valueOf(proof)).toBe(before);
      expect(await stored(layer)).toEqual(Option.some(before));
      expect(existsSync(join(legacy, LEGACY_PROOF_FILE))).toBe(false);
    }));

  test("an unsafe POSIX proof is refused, not adopted or replaced", () =>
    withUserData(async (userData) => {
      const legacy = join(userData, "language-private");
      const path = join(legacy, LEGACY_PROOF_FILE);

      loadLanguageCredential(legacy);
      chmodSync(path, 0o644);

      const contents = readFileSync(path, "utf8");
      const layer = files(userData);
      const { proof, warnings } = await start(layer, userData, "linux");

      expect(proof).toBeNull();
      expect(warnings).toEqual([WARNING]);
      expect(warnings.join(" ")).not.toContain(contents.trim());
      expect(readFileSync(path, "utf8")).toBe(contents);
      expect(await stored(layer)).toEqual(Option.none());
    }));

  test("Linux without a keyring (basic_text) keeps the POSIX proof file, as before", () =>
    withUserData(async (userData) => {
      const layer = files(userData, testSealer("plaintext-backend"));
      const first = await start(layer, userData, "linux");
      const second = await start(layer, userData, "linux");

      expect(first.warnings).toEqual([]);
      expect(valueOf(second.proof)).toBe(valueOf(first.proof));
      expect(readFileSync(join(userData, "language-private", LEGACY_PROOF_FILE), "utf8")).toBe(
        `${valueOf(first.proof)}\n`
      );
      expect(existsSync(join(userData, "secure"))).toBe(false);
    }));
});

describe("a stored proof that can't be trusted", () => {
  for (const [name, contents] of [
    ["corrupt", "sealed:bm90LWhleA=="],
    ["not sealed for this user", "planted"],
  ] as const) {
    test(`${name}: identity is off and the record is never replaced`, () =>
      withUserData(async (userData) => {
        const dir = join(userData, "secure", "languages");
        const path = join(dir, "client-proof.bin");

        mkdirSync(dir, { recursive: true });
        writeFileSync(path, contents);

        const { proof, warnings } = await start(files(userData), userData, "win32");

        expect(proof).toBeNull();
        expect(warnings).toEqual([WARNING]);
        expect(readFileSync(path, "utf8")).toBe(contents);
      }));
  }
});
