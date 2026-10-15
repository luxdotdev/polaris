import { describe, expect, test } from "bun:test";
import {
  type ClaudeSandbox,
  describeSandboxFailure,
  probeClaudeSandbox,
  unsandboxedReviewerNote,
} from "./sandbox.ts";
import { readOnlyOptions } from "./readOnly.ts";

const CONFINEMENT = {
  root: "/work/review",
  shellRoots: ["/work/repo/.git/objects", "/usr"],
  hidden: ["/work/review/.claude-config"],
  unwritable: ["/work/repo/.git"],
  shellEnv: { GIT_COMMON_DIR: "/work/sanitized" },
};

const ENV = {
  PATH: "/usr/bin",
  HOME: "/home/u",
  ANTHROPIC_API_KEY: "sk-ant",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth",
  GIT_COMMON_DIR: "/work/sanitized",
};

const linux = (...installed: ReadonlyArray<string>) =>
  probeClaudeSandbox({
    platform: "linux",
    find: (binary) => (installed.includes(binary) ? `/usr/bin/${binary}` : null),
  });

// What Claude Code 2.1.x printed on the tester's Linux Host without socat.
const RAW =
  "Sandbox required but unavailable: sandbox is enabled but dependencies are missing: socat not installed · install missing tools (e.g. apt install bubblewrap socat) or see https://code.claude.com/docs/en/sandboxing. Set sandbox.failIfUnavailable=false to allow unsandboxed execution.";

describe("Claude Code's sandbox on a Host", () => {
  test("macOS always has Seatbelt; Linux needs bubblewrap and socat", () => {
    expect(probeClaudeSandbox({ platform: "darwin", find: () => null })).toEqual({
      available: true,
    });
    expect(linux("bwrap", "socat")).toEqual({ available: true });
    expect(linux("bwrap")).toEqual({
      available: false,
      missing: [{ binary: "socat", pkg: "socat" }],
    });
    expect(linux()).toMatchObject({ available: false, missing: [{ pkg: "bubblewrap" }, {}] });
    expect(probeClaudeSandbox({ platform: "win32", find: () => "/x" })).toEqual({
      available: false,
      missing: [],
    });
  });

  test("a sandboxed read-only session reads only through its shell, which sees only the checkout and its tools", () => {
    const options = readOnlyOptions(linux("bwrap", "socat"), CONFINEMENT, ENV);

    expect(options.sandbox).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      filesystem: {
        // Claude Code's Linux sandbox otherwise lets a worktree's shell write its repository.
        denyWrite: ["/", "/work/repo/.git"],
        denyRead: ["/", "/work/review/.claude-config"],
        allowRead: ["/work/review", "/work/repo/.git/objects", "/usr"],
      },
    });
    // Claude Code passes its own environment to Bash: its provider keys are unset there.
    expect(options.sandbox?.credentials?.envVars).toEqual([
      { name: "ANTHROPIC_API_KEY", mode: "deny" },
      { name: "CLAUDE_CODE_OAUTH_TOKEN", mode: "deny" },
    ]);
    // File tools run outside the OS sandbox, so a sandboxed Reviewer has none.
    expect(options.tools).toEqual(["Bash", "Agent"]);

    for (const tool of ["Read", "Glob", "Grep"]) expect(options.disallowedTools).toContain(tool);
  });

  test("without the sandbox a read-only session has no shell and nothing that writes", () => {
    const options = readOnlyOptions(linux("bwrap"), CONFINEMENT, ENV);

    expect(options.sandbox).toEqual({ enabled: false });
    expect(options.tools).toEqual(["Read", "Glob", "Grep", "Agent"]);
    // Reads are allowed by path only: a bare `Read` would let Claude Code read anywhere.
    expect(options.allowedTools).toEqual(["Read(//work/review/**)", "Agent"]);
    expect(options.additionalDirectories).toEqual([]);
    expect(options.disallowedTools).toContain("Read(//work/review/.claude-config/**)");

    for (const tool of ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"])
      expect(options.disallowedTools).toContain(tool);
    expect(options).toMatchObject({
      permissionMode: "dontAsk",
      settingSources: [],
      mcpServers: {},
      strictMcpConfig: true,
      settings: {
        disableAllHooks: true,
        permissions: { blockReadsOutsideWorkingDirectories: true },
      },
    });
  });

  test("the Risk Summary's note names the Host and the install command", () => {
    expect(unsandboxedReviewerNote({ available: true }, "workbox")).toBeNull();
    expect(unsandboxedReviewerNote(linux("bwrap"), "workbox")).toBe(
      "The reviewer only read files: workbox has no socat for Claude Code's sandbox. Install it (apt install socat) to let the reviewer run git and checks."
    );
    expect(unsandboxedReviewerNote(linux(), "workbox")).toContain(
      "workbox has no bubblewrap and socat for Claude Code's sandbox. Install them (apt install bubblewrap socat)"
    );
  });

  test("Claude Code's raw sandbox error becomes a line naming the Host and the fix", () => {
    const missing: ClaudeSandbox = linux("bwrap");

    expect(describeSandboxFailure(RAW, { host: "workbox", sandbox: missing, own: true })).toBe(
      "Claude Code's sandbox can't start on workbox: socat isn't installed. Install it (apt install socat), or turn the sandbox off in your Claude Code settings."
    );
    expect(describeSandboxFailure(RAW, { host: "workbox", sandbox: missing, own: false })).toBe(
      "Claude Code's sandbox can't start on workbox: socat isn't installed. Install it (apt install socat)."
    );
    // The tools are there but the sandbox still won't start (user namespaces off, say).
    expect(
      describeSandboxFailure(RAW, { host: "workbox", sandbox: { available: true }, own: false })
    ).toBe(
      "Claude Code's sandbox can't start on workbox: sandbox is enabled but dependencies are missing: socat not installed."
    );
    expect(
      describeSandboxFailure("model not available", { host: "w", sandbox: missing, own: true })
    ).toBeNull();
  });
});
