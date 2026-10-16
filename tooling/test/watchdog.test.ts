import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WATCHDOG = join(import.meta.dir, "watchdog.ts");

const suite = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "watchdog-"));

  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);

  return dir;
};

const watch = async (
  dir: string,
  stallSeconds = 1,
  githubActions = false,
  args: ReadonlyArray<string> = []
) => {
  const proc = Bun.spawn(["bun", WATCHDOG, ...args], {
    cwd: dir,
    env: {
      ...process.env,
      POLARIS_TEST_STALL_S: String(stallSeconds),
      GITHUB_ACTIONS: githubActions ? "true" : "",
      CLAUDECODE: "",
      AI_AGENT: "",
      CLAUDE_CODE_ENTRYPOINT: "",
      CURSOR_AGENT: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { code, output: stdout + stderr };
};

const PASSES = `import { test } from "bun:test";\ntest("adds", () => {});\n`;

describe("the test watchdog", () => {
  test.each([
    ["locally", false],
    ["under GitHub Actions", true],
  ])(
    "a hung test %s fails the run and names its file and the last result before it",
    async (_, githubActions) => {
      const dir = suite({
        "a.test.ts": PASSES,
        "b.test.ts": `import { test } from "bun:test";\ntest("first", () => {});\ntest("hangs", () => new Promise(() => {}), 60_000);\n`,
      });

      const { code, output } = await watch(dir, 1, githubActions);

      expect(code).toBe(1);
      expect(output).toContain("bun test stalled: no output for 1s, in b.test.ts");
      expect(output).toContain("last result: (pass) first");
    },
    20_000
  );

  test.each([
    ["locally", false],
    ["under GitHub Actions", true],
  ])(
    "in a parallel run %s, a hung file is named and files that finished meanwhile are not",
    async (_, githubActions) => {
      const dir = suite({
        "hangs.test.ts": `import { test } from "bun:test";\ntest("first", () => {});\ntest("hangs", () => new Promise(() => {}), 60_000);\n`,
        "slow.test.ts": `import { test } from "bun:test";\nfor (const n of [1, 2, 3]) test(\`slow \${n}\`, () => Bun.sleep(300));\n`,
      });

      const { code, output } = await watch(dir, 2, githubActions, ["--parallel=2"]);

      expect(code).toBe(1);
      expect(output).toContain("bun test stalled: no output for 2s, in hangs.test.ts");
      expect(output).toContain("last result: (pass) first");
      expect(output).toContain("(pass) slow 3");
      expect(output).not.toContain("slow.test.ts\n  last result");
      expect(output).not.toContain("polaris-test");
    },
    20_000
  );

  test.each([
    ["passing", PASSES, 0],
    [
      "failing",
      `import { expect, test } from "bun:test";\ntest("no", () => expect(1).toBe(2));\n`,
      1,
    ],
  ])(
    "a %s run that finishes keeps bun's exit code and no stall report",
    async (_, body, exit) => {
      const { code, output } = await watch(suite({ "a.test.ts": body }), 30);

      expect(code).toBe(exit);
      expect(output).not.toContain("stalled");
    },
    20_000
  );
});
