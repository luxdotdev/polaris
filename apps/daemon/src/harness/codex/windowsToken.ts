/**
 * The Windows Codex server's capability token. Its directory gets a protected DACL of
 * the user's SID alone before anything is created in it, and the token is written under
 * a fresh name (exclusive create) and renamed into place, so no handle to it can be
 * opened by anyone else at any moment. See docs/adr/0061-windows-process-trees.md.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { childEnv } from "../../service/childEnv.ts";
import { system32 } from "../../platform/processes.ts";

/** Where the token lives, in its own directory beside the state file. */
export const tokenFileOf = (stateFile: string) =>
  join(dirname(stateFile), "codex-app-server", "token");

/** This user's SID from `whoami /user /fo csv /nh`: `"host\user","S-1-5-21-…"`. */
export const parseSid = (whoami: string): string | null =>
  /"(S-1-[0-9-]+)"/.exec(whoami)?.[1] ?? null;

const run = (argv: Array<string>): string | null => {
  const result = Bun.spawnSync(argv, {
    env: childEnv(),
    stdin: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });

  return result.exitCode === 0 ? result.stdout.toString() : null;
};

/** `icacls` arguments that leave `dir` (and what is created in it) to `sid` alone. */
export const privateDirAcl = (dir: string, sid: string): Array<string> => [
  dir,
  "/inheritance:r",
  "/grant:r",
  `*${sid}:(OI)(CI)F`,
];

/** Makes `dir` this user's only, whatever a shared POLARIS_HOME would pass down. */
const makePrivateDir = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  const sid = parseSid(run([system32("whoami.exe"), "/user", "/fo", "csv", "/nh"]) ?? "");

  if (sid === null || run([system32("icacls.exe"), ...privateDirAcl(dir, sid)]) === null)
    throw new Error(`could not make ${dir} private`);
};

/** A fresh token, so a client of a replaced server can't reach the new one. */
export const writeToken = (tokenFile: string): void => {
  makePrivateDir(dirname(tokenFile));
  const temporary = `${tokenFile}.${randomBytes(8).toString("hex")}`;

  writeFileSync(temporary, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  renameSync(temporary, tokenFile);
};
