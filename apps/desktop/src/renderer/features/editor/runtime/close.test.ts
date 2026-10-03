import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

test("pending close-save preserves retargeted/reopened views across load, format and write", () => {
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "close.regression.testing.ts")],
    {
      encoding: "utf8",
      timeout: 10000,
    }
  );

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("12 held-save runtime scenarios passed");
  expect(result.stdout).toContain("5 held-discard runtime scenarios passed");
});
