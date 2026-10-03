import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFakeCodex } from "../harness/codex/testing/fakeCodex.ts";

for (const phase of ["before", "after"])
  test(`${phase} adoption, hand-off stays out of command, Codex and terminal children`, () => {
    const home = mkdtempSync("/tmp/phc-");

    try {
      const codex = makeFakeCodex(home);
      const wrapper = join(home, "codex-wrapper");
      const marker = join(home, "codex-envelope");

      writeFileSync(
        wrapper,
        `#!/bin/sh\nif [ "$1" = app-server ]; then printf '%s' "\${POLARIS_HANDOFF-unset}" > '${marker}'; fi\nexec '${codex.path}' "$@"\n`
      );
      chmodSync(wrapper, 0o755);

      const result = spawnSync(
        process.execPath,
        [join(import.meta.dir, "fixtures/handoff-children.ts")],
        {
          env: {
            ...process.env,
            POLARIS_HOME: home,
            POLARIS_TEST_CODEX: wrapper,
            POLARIS_TEST_ADOPT: phase,
            POLARIS_HANDOFF: JSON.stringify({
              listenerFd: null,
              fds: {},
              children: {},
              fromVersion: "0.0.0-test",
              requestId: null,
            }),
          },
          encoding: "utf8",
          timeout: 25_000,
        }
      );

      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
