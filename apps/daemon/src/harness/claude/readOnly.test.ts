/** The Reviewer's file tools against a real checkout: what leaves it is refused, links included. */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { removeDir, tempDir, write } from "../../git/testing.ts";
import { checkoutHook } from "./readOnly.ts";

const cleanup: Array<string> = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) removeDir(dir);
});

const layout = () => {
  const base = tempDir("polaris-reviewer-reads-");
  cleanup.push(base);
  const root = join(base, "checkout");
  const outside = join(base, "outside");
  write(root, "src/a.ts", "export const a = 1;\n");
  write(outside, "secret.txt", "marker\n");
  symlinkSync(join(outside, "secret.txt"), join(root, "linked.txt"));
  symlinkSync(outside, join(root, "linked-dir"));
  mkdirSync(join(root, "empty"));

  return { root, outside };
};

describe("the Reviewer's file tools", () => {
  test("the hook lets file tools read and search inside the checkout, and nothing outside it", async () => {
    const { root, outside } = layout();

    const calls: ReadonlyArray<readonly [string, unknown, boolean]> = [
      ["Read", { file_path: join(root, "src/a.ts") }, true],
      ["Read", { file_path: "src/a.ts" }, true],
      ["Read", { file_path: join(root, "src/new.ts") }, true],
      ["Read", { file_path: join(outside, "secret.txt") }, false],
      ["Read", { file_path: join(root, "../outside/secret.txt") }, false],
      ["Read", { file_path: join(root, "linked.txt") }, false],
      ["Read", { file_path: join(root, "linked-dir/secret.txt") }, false],
      ["Read", { file_path: "/etc/hosts" }, false],
      ["Glob", { pattern: "**/*.ts" }, true],
      ["Glob", { pattern: "src/*.ts", path: root }, true],
      ["Glob", { pattern: `${root}/src/**` }, true],
      ["Glob", { pattern: `${outside}/**` }, false],
      ["Glob", { pattern: "../outside/*" }, false],
      ["Glob", { pattern: "*", path: outside }, false],
      ["Glob", { pattern: "*", path: join(root, "linked-dir") }, false],
      ["Grep", { pattern: "marker" }, true],
      ["Grep", { pattern: "marker", path: join(root, "src"), glob: "*.ts" }, true],
      ["Grep", { pattern: "marker", path: outside }, false],
      ["Grep", { pattern: "marker", path: join(root, "linked.txt") }, false],
      ["Grep", { pattern: "marker", glob: "../outside/*" }, false],
      ["Grep", { pattern: "marker", glob: `${outside}/*` }, false],
      ["Read", { file_path: 42 }, false],
      ["Read", {}, false],
      ["LS", { path: root }, false],
    ];

    const hook = checkoutHook(root);
    const signal = new AbortController().signal;

    const allowed = async ([tool_name, tool_input]: readonly [string, unknown, boolean]) => {
      const input = {
        hook_event_name: "PreToolUse" as const,
        tool_name,
        tool_input,
        tool_use_id: "t",
        session_id: "s",
        transcript_path: "/dev/null",
        cwd: root,
      };

      return Object.keys(await hook(input, "t", { signal })).length === 0;
    };

    const answers = await Promise.all(calls.map(allowed));

    expect(answers).toEqual(calls.map(([, , expected]) => expected));
    expect(
      await hook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Read",
          tool_input: { file_path: join(outside, "secret.txt") },
          tool_use_id: "t",
          session_id: "s",
          transcript_path: "/dev/null",
          cwd: root,
        },
        "t",
        { signal }
      )
    ).toMatchObject({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
    });
  });
});
