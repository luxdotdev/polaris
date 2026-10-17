/**
 * The Windows Codex server's capability token. Its directory and the token are
 * created with a security descriptor of the user's SID alone (owner and DACL), and
 * the token is written under a fresh name and renamed into place, so no handle to it
 * can be opened by anyone else at any moment. See docs/adr/0061-windows-process-trees.md.
 */
import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createPrivateDirectory,
  ownerOf,
  setPrivateDacl,
  thisUserSid,
  writePrivateFile,
} from "../../platform/windowsNative.ts";

/** Where the token lives, in its own directory beside the state file. */
export const tokenFileOf = (stateFile: string) =>
  join(dirname(stateFile), "codex-app-server", "token");

/** Administrators and SYSTEM: an owner only an administrator can be, who can read the token anyway. */
const ADMIN_OWNERS: ReadonlySet<string> = new Set(["S-1-5-32-544", "S-1-5-18"]);

/** Whether `owner` may own the token's directory or the state file: the user, or an administrator. */
export const isTrustedOwner = (owner: string | null, userSid: string): boolean =>
  owner !== null && (owner === userSid || ADMIN_OWNERS.has(owner));

/** Only a token or a temporary one: what a Polaris that made the directory leaves in it. */
export const isTokenName = (name: string): boolean => /^token(\.[0-9a-f]{16})?$/.test(name);

const refused = (dir: string, why: string) =>
  new Error(`${dir} ${why}; remove it, or set POLARIS_HOME to a directory only you can write`);

/** Removes a directory someone else made, if it holds only token files; false if it can't. */
const removeForeign = (dir: string): boolean => {
  try {
    const names = readdirSync(dir);

    if (!names.every((name) => isTokenName(name) && lstatSync(join(dir, name)).isFile()))
      return false;

    for (const name of names) rmSync(join(dir, name));
    rmdirSync(dir);

    return true;
  } catch {
    return false;
  }
};

/**
 * Makes `dir` this user's only. A new one is created with that descriptor; an existing
 * one keeps its owner only when trusted, else it is replaced if it holds nothing else.
 */
export const makePrivateDir = (dir: string): void => {
  mkdirSync(dirname(dir), { recursive: true });

  if (createPrivateDirectory(dir)) return;
  const stat = lstatSync(dir);

  if (stat.isSymbolicLink() || !stat.isDirectory()) throw refused(dir, "is not a directory");
  const owner = ownerOf(dir);

  if (isTrustedOwner(owner, thisUserSid()) && setPrivateDacl(dir, "directory")) return;

  if (!removeForeign(dir) || !createPrivateDirectory(dir))
    throw refused(dir, `belongs to ${owner ?? "an unknown owner"}, not this user`);
};

/** A fresh token, so a client of a replaced server can't reach the new one. */
export const writeToken = (tokenFile: string): void => {
  makePrivateDir(dirname(tokenFile));
  writePrivateFile(tokenFile, randomBytes(32).toString("hex"));
};
