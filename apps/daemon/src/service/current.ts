/**
 * `~/.polaris/bin/current`, the installed version every launcher goes through:
 * a relative symlink on macOS and Linux, a directory junction on Windows, where
 * a symlink needs a privilege or Developer Mode and a junction needs neither (ADR 0060).
 */
import { lstatSync, readlinkSync, renameSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export type CurrentLink = "symlink" | "junction";

export const currentLinkFor = (os: string): CurrentLink =>
  os === "win32" ? "junction" : "symlink";

/** The executable's file name in a version directory. */
export const binaryNameFor = (os: string): string => (os === "win32" ? "polaris.exe" : "polaris");

/**
 * The version a link target names: a symlink's is the bare version, a junction's
 * an absolute path, possibly `\\?\`-prefixed, ending in the version directory.
 */
export const versionOfTarget = (target: string): string | null =>
  target.split(/[\\/]+/).findLast((part) => part !== "") ?? null;

/** The version `bin/current` points at, or null when there is none. */
export const readCurrent = (bin: string): string | null => {
  try {
    return versionOfTarget(readlinkSync(join(bin, "current")));
  } catch {
    return null;
  }
};

const isPresent = (path: string) => {
  try {
    lstatSync(path);

    return true;
  } catch {
    return false;
  }
};

/** Removes a link, never what it points at; a junction is removed as a directory. */
const removeLink = (path: string) => {
  if (!isPresent(path)) return;

  try {
    unlinkSync(path);
  } catch {
    rmdirSync(path);
  }
};

/**
 * Points `bin/current` at `bin/<version>`; false if it already did. A symlink is
 * renamed over the old one (atomic). A junction can't replace a directory by rename,
 * so the old one moves aside first: for that instant there is no `current`.
 */
export const pointCurrent = (bin: string, version: string, link: CurrentLink): boolean => {
  if (readCurrent(bin) === version) return false;
  const current = join(bin, "current");
  const temp = `${current}.tmp-${process.pid}`;
  removeLink(temp);

  if (link === "symlink") {
    symlinkSync(version, temp);
    renameSync(temp, current);

    return true;
  }

  symlinkSync(join(bin, version), temp, "junction");
  const aside = `${current}.old-${process.pid}`;

  if (isPresent(current)) renameSync(current, aside);
  renameSync(temp, current);
  removeLink(aside);

  return true;
};
