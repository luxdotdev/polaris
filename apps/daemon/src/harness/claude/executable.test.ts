import { expect, test } from "bun:test";
import { copyFileSync, linkSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeExecutable } from "./executable.ts";

const SHIM = "C:\\npm\\claude.cmd";

test.each([
  {
    name: "npm's claude.exe is started directly",
    launch: { program: "C:\\npm\\node_modules\\claude\\bin\\claude.exe", args: [] },
    expected: { pathToClaudeCodeExecutable: "C:\\npm\\node_modules\\claude\\bin\\claude.exe" },
  },
  {
    name: "a node the shim doesn't name by absolute path isn't trusted",
    launch: { program: "node.exe", args: ["C:\\npm\\node_modules\\claude\\cli.js"] },
    expected: { pathToClaudeCodeExecutable: SHIM },
  },
  {
    name: "a shim the SDK can't run another way keeps its path",
    launch: { program: "C:\\perl\\perl.exe", args: ["C:\\npm\\node_modules\\claude\\cli"] },
    expected: { pathToClaudeCodeExecutable: SHIM },
  },
])("$name", ({ launch, expected }) => {
  expect(claudeExecutable(SHIM, launch)).toEqual(expected);
});

test("npm's cli.js runs under the shim's own node, never a bare one", async () => {
  const seen = mkdtempSync(join(tmpdir(), "polaris-node-"));
  const node = join(seen, process.platform === "win32" ? "node.exe" : "node");

  // A hard link can't cross volumes (CI's temp is on another drive on Windows).
  try {
    linkSync(process.execPath, node);
  } catch {
    copyFileSync(process.execPath, node);
  }

  const options = claudeExecutable(SHIM, {
    program: node,
    args: ["C:\\npm\\node_modules\\claude\\cli.js"],
  });

  expect(options.pathToClaudeCodeExecutable).toBe("C:\\npm\\node_modules\\claude\\cli.js");
  expect(options.executable).toBe("node");

  // The SDK asks for `node`; the spawn runs the absolute program the shim named instead.
  const script = join(seen, "argv.js");
  writeFileSync(
    script,
    "console.log(JSON.stringify([process.execPath, ...process.argv.slice(2)]))"
  );

  const child = options.spawnClaudeCodeProcess?.({
    command: "node",
    args: [script, "--print"],
    cwd: seen,
    env: { ...process.env },
    signal: new AbortController().signal,
  });

  const out = await new Response(child?.stdout).text();

  expect(JSON.parse(out)).toEqual([realpathSync(node), "--print"]);
  rmSync(seen, { recursive: true, force: true });
});
