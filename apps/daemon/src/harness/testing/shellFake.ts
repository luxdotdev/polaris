import { chmodSync, writeFileSync } from "node:fs";
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
