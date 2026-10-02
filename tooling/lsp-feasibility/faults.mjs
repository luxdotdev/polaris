import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fixtureEnvironment } from "./process.mjs";

const fixtureRoot = process.argv[2];

for (const probe of ["typescript", "lsp"]) {
  for (const fault of ["failure", "timeout"]) {
    const script = fileURLToPath(new URL(`./${probe}.mjs`, import.meta.url));

    const result = spawnSync(process.execPath, [script, fixtureRoot, fault], {
      env: fixtureEnvironment(fixtureRoot),
      encoding: "utf8",
      timeout: 30000,
    });

    assert.equal(
      result.status,
      1,
      `${probe} ${fault}: expected controlled failure, got ${result.status}`
    );
    assert.ok(
      result.stderr.includes(
        fault === "failure" ? "Injected fixture failure" : "Fixture deadline exceeded"
      )
    );
    assert.ok(
      result.stdout.includes("reaped; no remaining group"),
      `${probe} ${fault}: missing verified cleanup`
    );
    console.log(result.stdout.trim());
    console.log(`Real ${probe} injected ${fault}: expected exit 1; bounded cleanup confirmed PASS`);
  }
}
