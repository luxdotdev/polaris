/** The shell command follows `current`, so a Daemon Upgrade keeps the same entry point. */
import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface CommandLink {
  readonly path: string;
  readonly target: string;
  readonly state: "absent" | "installed" | "conflict";
  readonly onPath: boolean;
}

export const commandTarget = (polarisHome: string) =>
  join(polarisHome, "bin", "current", "polaris");

export const userCommandPath = (userHome: string) => join(userHome, ".local", "bin", "polaris");

export const inspectCommand = (path: string, target: string, shellPath: string): CommandLink => {
  let state: CommandLink["state"] = "absent";

  try {
    const stat = lstatSync(path);
    state = stat.isSymbolicLink() && readlinkSync(path) === target ? "installed" : "conflict";
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  return {
    path,
    target,
    state,
    onPath: shellPath.split(":").some((entry) => entry !== "" && resolve(entry) === dirname(path)),
  };
};

export const installCommandLink = (path: string, target: string): void => {
  const link = inspectCommand(path, target, "");

  if (link.state === "conflict")
    throw new Error(`${path} already exists and belongs to another command`);
  accessSync(target, constants.X_OK);

  if (link.state === "installed") return;
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path);
};

/** Never delete a file or another install's link, including a dangling one. */
export const uninstallCommandLink = (path: string, target: string): void => {
  if (inspectCommand(path, target, "").state === "installed") unlinkSync(path);
};

export const commandPathHint = (link: CommandLink): string | null =>
  link.onPath
    ? null
    : `Add ${dirname(link.path)} to PATH in your shell configuration, then open a new shell. For sh, bash or zsh: export PATH="${dirname(link.path)}:$PATH"`;
