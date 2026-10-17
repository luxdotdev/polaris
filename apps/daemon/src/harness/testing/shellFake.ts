import { chmodSync, copyFileSync, linkSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const windows = process.platform === "win32";

/** Git for Windows' sh, which runs the fakes' scripts there; `/bin/sh` elsewhere. */
const windowsSh = (): string => {
  const sh = Bun.which("sh");

  if (sh !== null) return sh;
  const git = Bun.which("git");

  if (git === null) throw new Error("no sh: install Git for Windows");

  // git.exe sits in Git\cmd; sh.exe in Git\bin.
  return join(dirname(dirname(git)), "bin", "sh.exe");
};

/** A path written into a fake's script: sh on Windows reads a backslash as an escape. */
export const shPath = (path: string): string => (windows ? path.replaceAll("\\", "/") : path);

/**
 * Writes `dir/name`, an executable sh script with `body`, and returns the path to run it
 * by. On Windows that is `name.cmd`, which runs the script through Git for Windows' sh,
 * and which `PATH` lookups find as `name`.
 */
export const shellFake = (dir: string, name: string, body: string): string => {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);

  if (!windows) return path;
  writeFileSync(`${path}.cmd`, `@"${windowsSh()}" "%~dpn0" %*\r\n`);

  return `${path}.cmd`;
};

/**
 * Writes `dir/name`, a Bun script with `source`, and returns the path to run it by: the
 * script itself (its shebang names this Bun), or on Windows `name.cmd`, which runs it with this Bun.
 */
export const bunFake = (dir: string, name: string, source: string): string => {
  const path = join(dir, name);
  writeFileSync(path, `#!${process.execPath}\n${source}`);
  chmodSync(path, 0o755);

  if (!windows) return path;
  writeFileSync(`${path}.cmd`, `@"${process.execPath}" "%~dpn0" %*\r\n`);

  return `${path}.cmd`;
};

/** The `.cmd` npm 9's cmd-shim writes for a `bin` script whose shebang names node. */
const npmScriptShim = (target: string) =>
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
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ") ELSE (",
    '  SET "_prog=node"',
    "  SET PATHEXT=%PATHEXT:;.JS;=;%",
    ")",
    "",
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*`,
    "",
  ].join("\r\n");

/**
 * Installs `name` in `dir/node_modules` as npm would: a Bun script, linked from `.bin`, or
 * on Windows npm's `.bin\name.cmd` shim with this Bun beside it as `node.exe`. Returns the bin.
 */
export const npmFake = (dir: string, name: string, source: string): string => {
  const bin = join(dir, "node_modules", ".bin");
  const script = join(dir, "node_modules", name, "cli.js");
  mkdirSync(dirname(script), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(script, `#!${process.execPath}\n${source}`);
  chmodSync(script, 0o755);

  if (!windows) {
    symlinkSync(join("..", name, "cli.js"), join(bin, name));

    return join(bin, name);
  }

  try {
    linkSync(process.execPath, join(bin, "node.exe"));
  } catch {
    copyFileSync(process.execPath, join(bin, "node.exe"));
  }

  writeFileSync(join(bin, `${name}.cmd`), npmScriptShim(`..\\${name}\\cli.js`));

  return join(bin, `${name}.cmd`);
};
