/** Local links only. System-wide changes request macOS authorization when the user chooses them. */
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  commandTarget,
  inspectCommand,
  installCommandLink,
  uninstallCommandLink,
  userCommandPath,
} from "../../../daemon/src/install/command.ts";
import type { CommandInstallView, CommandLocation } from "../shared/commandInstall.ts";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** No force-overwrite: a file or another install's symlink always stays. */
export const systemCommandScript = (
  action: "install" | "uninstall",
  path: string,
  target: string
) => {
  const p = quote(path);
  const t = quote(target);
  const owned = `[ -L ${p} ] && [ "$(/usr/bin/readlink ${p})" = ${t} ]`;

  return action === "uninstall"
    ? `if ${owned}; then /bin/rm ${p}; fi`
    : `if ${owned}; then exit 0; fi; if [ -e ${p} ] || [ -L ${p} ]; then echo 'An existing command was kept' >&2; exit 1; fi; /bin/mkdir -p ${quote(dirname(path))} && /bin/ln -s ${t} ${p}`;
};

const authorize = (script: string): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      ["-e", `do shell script ${JSON.stringify(script)} with administrator privileges`],
      { timeout: 120_000 },
      (error) => (error === null ? resolve() : reject(error))
    );
  });

export interface CommandInstallOptions {
  readonly userHome?: string;
  readonly systemBin?: string;
  readonly polarisHome?: string;
  readonly platform?: string;
  readonly path: () => string;
  readonly dismissed: () => boolean;
  readonly dismiss: () => void;
  readonly authorize?: (script: string) => Promise<void>;
}

export const createCommandInstaller = (options: CommandInstallOptions) => {
  const userHome = options.userHome ?? homedir();

  const target = commandTarget(options.polarisHome ?? join(userHome, ".polaris"));

  const platform = options.platform ?? process.platform;

  const supported = platform === "darwin" || platform === "linux";

  const locations: ReadonlyArray<CommandLocation> =
    platform === "darwin" ? ["user", "system"] : ["user"];

  const pathOf = (location: CommandLocation) =>
    location === "user"
      ? userCommandPath(userHome)
      : join(options.systemBin ?? "/usr/local/bin", "polaris");

  let changing = false;

  const get = (): CommandInstallView => {
    let available = false;

    try {
      accessSync(target, constants.X_OK);
      available = true;
    } catch {
      /* The local Daemon is not installed yet. */
    }

    return {
      supported,
      available,
      dismissed: options.dismissed(),
      links: !supported
        ? []
        : locations.map((location) => ({
            location,
            ...inspectCommand(pathOf(location), target, options.path()),
          })),
    };
  };

  return {
    get,
    dismiss: () => {
      options.dismiss();

      return get();
    },
    change: async (action: "install" | "uninstall", location: CommandLocation) => {
      if (!supported || !locations.includes(location))
        throw new Error("Command installation is not available on this machine");

      if (changing) throw new Error("A command installation is already in progress");
      changing = true;

      try {
        const path = pathOf(location);
        const link = inspectCommand(path, target, options.path());

        if (link.state === "conflict")
          throw new Error(`${path} already exists and belongs to another command`);

        if (action === "install" && !get().available)
          throw new Error("Install the local daemon from Settings → Hosts first");

        if (
          (action === "install" && link.state === "installed") ||
          (action === "uninstall" && link.state === "absent")
        )
          return get();

        if (location === "system")
          await (options.authorize ?? authorize)(systemCommandScript(action, path, target));
        else if (action === "install") installCommandLink(path, target);
        else uninstallCommandLink(path, target);
        options.dismiss();

        return get();
      } finally {
        changing = false;
      }
    },
  };
};

export type CommandInstaller = ReturnType<typeof createCommandInstaller>;
