/**
 * The fallback hand-off to macOS Terminal: `ssh <alias>` to trust a host key
 * when the local Host is off (the in-app terminal runs on a Daemon). Polaris
 * never answers the prompt itself (ENG-179).
 */
import { shellQuote } from "@polaris/client/install";
import { resolveSshBinary, type SshOptions } from "@polaris/client";
import { spawn } from "node:child_process";
import { win32 } from "node:path";
import { Option, Schema } from "effect";

/** The script Terminal runs: the command, then a pause so its output stays readable. */
export const terminalScript = (argv: ReadonlyArray<string>): string =>
  [
    "#!/bin/sh",
    `${argv.map(shellQuote).join(" ")}`,
    'printf "\\n[Polaris: done. Close this window, then retry in Polaris.]\\n"',
    "",
  ].join("\n");

/** `ssh <alias>`, interactive, so ssh can ask to trust the key or for a password. */
export const sshArgv = (alias: string, options: SshOptions = {}): ReadonlyArray<string> => [
  resolveSshBinary(options),
  "--",
  alias,
];

export interface TerminalCommand {
  readonly file: string;
  readonly args: ReadonlyArray<string>;
  readonly windowsVerbatimArguments?: boolean;
}

/** cmd parses metacharacters even without a shell-enabled process spawner. */
export const windowsTerminalCommands = (
  argv: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = process.env
): ReadonlyArray<TerminalCommand> => {
  if (argv.some((arg) => /[\r\n"%!&|<>^;]/.test(arg))) throw new Error("Unsafe terminal argument.");

  const cmd =
    env.ComSpec ??
    env.COMSPEC ??
    win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows", "System32", "cmd.exe");

  return [
    { file: "wt.exe", args: ["new-tab", "--", ...argv] },
    {
      file: cmd,
      args: ["/d", "/v:off", "/s", "/k", `"${argv.map((arg) => `"${arg}"`).join(" ")}"`],
      windowsVerbatimArguments: true,
    },
  ];
};

const spawnError = Schema.decodeUnknownOption(Schema.Struct({ code: Schema.String }));

const launch = ({
  file,
  args,
  windowsVerbatimArguments = false,
}: TerminalCommand): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      windowsVerbatimArguments,
    });

    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
    child.once("error", (error) => {
      if (Option.exists(spawnError(error), (value) => value.code === "ENOENT")) resolve(false);
      else reject(error);
    });
  });

/** Windows Terminal when available, otherwise a persistent command window. */
export const openWindowsTerminal = async (
  argv: ReadonlyArray<string>,
  start: (command: TerminalCommand) => Promise<boolean> = launch,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> => {
  for (const command of windowsTerminalCommands(argv, env)) {
    if (await start(command)) return;
  }

  throw new Error("No Windows terminal is available.");
};
