import { expect, test } from "bun:test";
import { claudeExecutable } from "./executable.ts";

const SHIM = "C:\\npm\\claude.cmd";

test.each([
  {
    name: "npm's claude.exe is started directly",
    launch: { program: "C:\\npm\\node_modules\\claude\\bin\\claude.exe", args: [] },
    expected: { pathToClaudeCodeExecutable: "C:\\npm\\node_modules\\claude\\bin\\claude.exe" },
  },
  {
    name: "npm's cli.js runs under node",
    launch: { program: "C:\\nodejs\\node.exe", args: ["C:\\npm\\node_modules\\claude\\cli.js"] },
    expected: {
      pathToClaudeCodeExecutable: "C:\\npm\\node_modules\\claude\\cli.js",
      executable: "node",
    },
  },
  {
    name: "a shim the SDK can't run another way keeps its path",
    launch: { program: "C:\\perl\\perl.exe", args: ["C:\\npm\\node_modules\\claude\\cli"] },
    expected: { pathToClaudeCodeExecutable: SHIM },
  },
])("$name", ({ launch, expected }) => {
  expect(claudeExecutable(SHIM, launch)).toEqual(expected);
});
