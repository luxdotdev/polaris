import { describe, expect, test } from "bun:test";
import { launchOf, parseCmdShim, type ShimIo } from "./cmdShim.ts";

const BIN = "C:\\proj\\node_modules\\.bin";

/** What npm 9's cmd-shim writes for a native `bin` (Claude Code 2.1.302's `bin/claude.exe`). */
const nativeShim = (target: string) =>
  [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    `"%dp0%\\${target}"   %*`,
    "",
  ].join("\r\n");

/** What npm 9's cmd-shim writes for a script `bin` with a `#!/usr/bin/env <interpreter>` line. */
const scriptShim = (target: string, interpreter = "node") =>
  [
    "@ECHO off",
    "GOTO start",
    ":find_dp0",
    "SET dp0=%~dp0",
    "EXIT /b",
    ":start",
    "SETLOCAL",
    "CALL :find_dp0",
    "",
    `IF EXIST "%dp0%\\${interpreter}.exe" (`,
    `  SET "_prog=%dp0%\\${interpreter}.exe"`,
    ") ELSE (",
    `  SET "_prog=${interpreter}"`,
    "  SET PATHEXT=%PATHEXT:;.JS;=;%",
    ")",
    "",
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*`,
    "",
  ].join("\r\n");

const CLAUDE_EXE = "C:\\proj\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe";

const CLI_JS = "C:\\proj\\node_modules\\@anthropic-ai\\claude-code\\cli.js";

const NODE = "C:\\Program Files\\nodejs\\node.exe";

const SHIM = `${BIN}\\claude.cmd`;

/** A Host with `SHIM` holding `text`, the files in `files`, and `node` on PATH. */
const io = (text: string, files: ReadonlyArray<string>): ShimIo => ({
  read: (path) => (path === SHIM ? text : null),
  exists: (path) => path === SHIM || files.includes(path),
  which: (name) => (name === "node" ? NODE : null),
});

describe("an npm .cmd shim", () => {
  test.each([
    {
      name: "a native bin runs itself",
      shim: nativeShim("..\\@anthropic-ai\\claude-code\\bin\\claude.exe"),
      files: [CLAUDE_EXE],
      expected: { program: CLAUDE_EXE, args: [] },
    },
    {
      name: "a script runs under the node on PATH",
      shim: scriptShim("..\\@anthropic-ai\\claude-code\\cli.js"),
      files: [CLI_JS, NODE],
      expected: { program: NODE, args: [CLI_JS] },
    },
    {
      name: "a script runs under the node beside the shim",
      shim: scriptShim("..\\@anthropic-ai\\claude-code\\cli.js"),
      files: [CLI_JS, `${BIN}\\node.exe`],
      expected: { program: `${BIN}\\node.exe`, args: [CLI_JS] },
    },
  ])("$name", ({ shim, files, expected }) => {
    expect(launchOf(SHIM, "win32", io(shim, [...files, NODE]))).toEqual(expected);
  });

  test.each([
    { name: "its target is missing", text: nativeShim("..\\gone\\claude.exe") },
    { name: "its interpreter isn't installed", text: scriptShim("..\\x\\cli", "perl") },
    { name: "it isn't npm's", text: '@"C:\\Git\\bin\\sh.exe" "%~dpn0" %*\r\n' },
    { name: "it runs nothing with the caller's arguments", text: "@echo hi\r\n" },
  ])("is run as itself when $name", ({ text }) => {
    const host = io(text, ["C:\\proj\\node_modules\\x\\cli", NODE]);

    expect(parseCmdShim(SHIM, text, host)).toBeNull();
    expect(launchOf(SHIM, "win32", host)).toEqual({ program: SHIM, args: [] });
  });

  test("is only read on Windows", () => {
    const host = io(nativeShim("..\\@anthropic-ai\\claude-code\\bin\\claude.exe"), [CLAUDE_EXE]);

    expect(launchOf(SHIM, "linux", host)).toEqual({ program: SHIM, args: [] });
  });
});
