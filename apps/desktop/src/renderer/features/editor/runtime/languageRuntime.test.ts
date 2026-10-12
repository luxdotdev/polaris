import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

test("a replaced app module uses the open buffer's existing language owner for Check again", () => {
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "languageRuntime.testing.ts")],
    {
      encoding: "utf8",
      timeout: 10000,
    }
  );

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(
    "reloaded runtime rechecks through the original open-buffer coordinator"
  );
});
