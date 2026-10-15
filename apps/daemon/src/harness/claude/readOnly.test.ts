/** The Reviewer's file tools against a real checkout: what leaves it is refused, links included. */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { removeDir, tempDir, write } from "../../git/testing.ts";
import { checkoutHook, readOnlyEnv } from "./readOnly.ts";

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
  write(base, "sibling.txt", "marker\n");
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
      // Claude Code expands these itself, so they must never pass as paths inside the root.
      ["Read", { file_path: "~/.ssh/id_rsa" }, false],
      ["Read", { file_path: "$HOME/.ssh/id_rsa" }, false],
      ["Read", { file_path: "%USERPROFILE%/.ssh/id_rsa" }, false],
      ["Read", { file_path: `file://${outside}/secret.txt` }, false],
      ["Read", { file_path: "..\\outside\\secret.txt" }, false],
      // The OS follows the link before `..`; a lexical resolve would land inside.
      ["Read", { file_path: `${root}/linked-dir/../sibling.txt` }, false],
      ["Glob", { pattern: "**/*.ts" }, true],
      ["Glob", { pattern: "src/*.ts", path: root }, true],
      ["Glob", { pattern: `${root}/src/**` }, true],
      ["Glob", { pattern: `${outside}/**` }, false],
      ["Glob", { pattern: "../outside/*" }, false],
      ["Glob", { pattern: "{..,src}/*" }, false],
      ["Glob", { pattern: "*", path: "~" }, false],
      ["Glob", { pattern: "*", path: outside }, false],
      ["Glob", { pattern: "*", path: join(root, "linked-dir") }, false],
      ["Grep", { pattern: "marker" }, true],
      ["Grep", { pattern: "^export .*;$" }, true],
      ["Grep", { pattern: "marker", path: "~/.ssh" }, false],
      ["Grep", { pattern: "marker", glob: "{..,src}/*" }, false],
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

describe("the Reviewer's environment", () => {
  const confinement = {
    root: "/work/review",
    shellRoots: [],
    hidden: [],
    shellEnv: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_COMMON_DIR: "/work/sanitized" },
  };

  const daemon = {
    PATH: "/usr/bin",
    HOME: "/home/u",
    HTTPS_PROXY: "http://proxy:3128",
    ANTHROPIC_API_KEY: "sk-ant",
    CLAUDE_CONFIG_DIR: "/home/u/.claude",
    GITHUB_TOKEN: "ghp_x",
    OPENAI_API_KEY: "sk-openai",
    SSH_AUTH_SOCK: "/tmp/agent.sock",
    AWS_SECRET_ACCESS_KEY: "aws",
    POLARIS_HOME: "/home/u/.polaris",
  };

  test("Claude Code gets what it needs and the confined git, not other services' keys", () => {
    expect(readOnlyEnv(daemon, confinement)).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/u",
      HTTPS_PROXY: "http://proxy:3128",
      ANTHROPIC_API_KEY: "sk-ant",
      CLAUDE_CONFIG_DIR: "/home/u/.claude",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_COMMON_DIR: "/work/sanitized",
    });
  });

  test("a cloud provider's credentials stay only while Claude Code uses that provider", () => {
    expect(readOnlyEnv({ ...daemon, CLAUDE_CODE_USE_BEDROCK: "1" }, confinement)).toMatchObject({
      AWS_SECRET_ACCESS_KEY: "aws",
    });
    expect(
      readOnlyEnv({ ...daemon, CLAUDE_CODE_USE_BEDROCK: "0" }, confinement)
    ).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
  });
});
