import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Schema } from "effect";

const OXLINT = join(import.meta.dir, "../../../node_modules/.bin/oxlint");

const Report = Schema.Struct({
  diagnostics: Schema.Array(Schema.Struct({ code: Schema.String, filename: Schema.String })),
});

/** Spawning oxlint with its JS plugins takes several seconds on a cold CI runner. */
const SPAWN_TIMEOUT_MS = 30_000;

/** Runs oxlint on one plugin's fixtures with that plugin's fixture config. */
function lintFixtures(plugin: string) {
  const dir = join(import.meta.dir, plugin, "test");

  const run = Bun.spawnSync(
    [OXLINT, "-c", "fixtures.oxlintrc.json", "--format", "json", "fixtures"],
    { cwd: dir }
  );

  const report = Schema.decodeUnknownSync(Schema.fromJsonString(Report))(run.stdout.toString());

  return report.diagnostics;
}

describe("custom oxlint plugins", () => {
  test(
    "polaris/no-long-comment reports each over-long group once",
    () => {
      const diagnostics = lintFixtures("polaris").filter(
        (d) => d.code === "polaris(no-long-comment)"
      );

      expect(diagnostics.filter((d) => !d.filename.endsWith("long-comment.ts"))).toEqual([]);
      expect(diagnostics).toHaveLength(4);
    },
    SPAWN_TIMEOUT_MS
  );

  test(
    "polaris/await-expect-promise reports only unawaited rejects and resolves",
    () => {
      const diagnostics = lintFixtures("polaris").filter(
        (d) => d.code === "polaris(await-expect-promise)"
      );

      expect(diagnostics.map((d) => d.filename)).toEqual([
        "fixtures/unawaited-expect.ts",
        "fixtures/unawaited-expect.ts",
        "fixtures/unawaited-expect.ts",
      ]);
    },
    SPAWN_TIMEOUT_MS
  );

  test(
    "sonarjs/cognitive-complexity reports only the tangled function",
    () => {
      const diagnostics = lintFixtures("sonarjs");

      expect(diagnostics.map((d) => [d.code, d.filename])).toEqual([
        ["sonarjs(cognitive-complexity)", "fixtures/complex.ts"],
      ]);
    },
    SPAWN_TIMEOUT_MS
  );
});
