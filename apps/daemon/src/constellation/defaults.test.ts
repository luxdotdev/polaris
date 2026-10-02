import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConstellationSettings } from "@polaris/protocol";
import { Effect } from "effect";
import { ConstellationDefaultsPath, getDefaults, setDefaults } from "./defaults.ts";

test("Host defaults round-trip atomically and tolerate missing or invalid settings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "c1-defaults-"));
  const path = join(dir, "settings.json");

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        expect((yield* getDefaults).branchPrefix).toBeUndefined();
        const settings = ConstellationSettings.make({ branchPrefix: "team", transfer: "bundle" });
        yield* setDefaults(settings);
        expect(yield* getDefaults).toEqual(settings);
        writeFileSync(path, "broken");
        expect((yield* getDefaults).branchPrefix).toBeUndefined();
      }).pipe(Effect.provideService(ConstellationDefaultsPath, path))
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
