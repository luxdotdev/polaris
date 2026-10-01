/**
 * `polaris selftest`: checks that this build's native pieces work on this
 * Host: fff's library, which `bun build --compile` embeds (see
 * scripts/build-daemon.ts; without it, file search silently falls back to
 * git), and the Rules' ast-grep addon, grammars and Betterleaks binary. The
 * build and CI run this against every binary they can execute.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fffLoadError, openFffBackend } from "../files/search/fff.ts";
import { rulesSelfTest } from "../rules/selftest.ts";
import { versionLine } from "./platform.ts";

export interface SelfTestResult {
  readonly ok: boolean;
  readonly lines: ReadonlyArray<string>;
}

export const selfTest = async (): Promise<SelfTestResult> => {
  const scratch = mkdtempSync(join(tmpdir(), "polaris-selftest-"));
  const previousHome = process.env.POLARIS_HOME;
  process.env.POLARIS_HOME = join(scratch, "home");

  try {
    const root = join(scratch, "root");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "polaris-selftest-needle.txt"), "needle\n");
    const backend = await openFffBackend(root);

    if (backend === null) {
      return {
        ok: false,
        lines: [versionLine(), `fff: unavailable (${fffLoadError() ?? "unknown"})`],
      };
    }

    try {
      const hits = await backend.searchPaths("selftestneedle", 5);
      const found = hits.some((hit) => hit.path.endsWith("polaris-selftest-needle.txt"));

      // A regex grep: fff's worker (its own entrypoint in the binary) and the literal narrowing.
      const grep = await backend.grep({
        pattern: "nee+dle$",
        regex: true,
        caseSensitive: false,
        limit: 5,
      });

      const grepped = grep.length === 1 && grep[0]!.path.endsWith("polaris-selftest-needle.txt");
      const fffOk = found && grepped;
      const rules = await rulesSelfTest(scratch);

      return {
        ok: fffOk && rules.ok,
        lines: [
          versionLine(),
          fffOk ? "fff: ok" : `fff: loaded but ${found ? "grep" : "search"} found nothing`,
          rules.line,
        ],
      };
    } finally {
      backend.dispose();
    }
  } finally {
    if (previousHome === undefined) delete process.env.POLARIS_HOME;
    else process.env.POLARIS_HOME = previousHome;
    rmSync(scratch, { recursive: true, force: true });
  }
};
