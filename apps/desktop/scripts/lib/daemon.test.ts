import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a fresh source Daemon ignores its parent's upgrade hand-off", () => {
  const home = mkdtempSync(join(tmpdir(), "polaris-smoke-handoff-"));

  try {
    const result = spawnSync("node", [join(import.meta.dir, "fixtures/daemon-start.ts"), home], {
      env: {
        ...process.env,
        POLARIS_HANDOFF: JSON.stringify({
          listenerFd: 999_999,
          fds: {},
          children: {},
          fromVersion: "0.0.0-test",
          requestId: null,
        }),
      },
      encoding: "utf8",
      timeout: 25_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
