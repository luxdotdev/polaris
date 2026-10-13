/**
 * The fallback hand-off to the Client's own terminal (Terminal on macOS, Windows Terminal or
 * cmd, a Linux terminal emulator): `ssh <alias>` to trust a host key when the local Host is
 * off (the in-app terminal runs on a Daemon). Polaris never answers the prompt itself (ENG-179).
 */
import { shellQuote } from "@polaris/client/install";
import { resolveSshBinary, type SshOptions } from "@polaris/client";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { Option, Schema } from "effect";

/**
 * The script the terminal runs: the command, then a note so its output stays readable. Linux
 * emulators close when it exits, so there it waits for Enter.
 */
export const terminalScript = (argv: ReadonlyArray<string>, waitForEnter = false): string =>
  [
    "#!/bin/sh",
    `${argv.map(shellQuote).join(" ")}`,
    waitForEnter
      ? 'printf "\\n[Polaris: done. Press Enter to close, then retry in Polaris.]\\n"; read -r _'
      : 'printf "\\n[Polaris: done. Close this window, then retry in Polaris.]\\n"',
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

/** Starts the first command whose program exists; `missing` when none does. */
const startFirst = async (
  commands: ReadonlyArray<TerminalCommand>,
  start: (command: TerminalCommand) => Promise<boolean>,
  missing: string
): Promise<void> => {
  for (const command of commands) {
    if (await start(command)) return;
  }

  throw new Error(missing);
};

/** Windows Terminal when available, otherwise a persistent command window. */
export const openWindowsTerminal = (
  argv: ReadonlyArray<string>,
  start: (command: TerminalCommand) => Promise<boolean> = launch,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> =>
  startFirst(windowsTerminalCommands(argv, env), start, "No Windows terminal is available.");

/** The user's `$TERMINAL`, then Debian's alternative, then the common emulators, each running `script`. */
export const linuxTerminalCommands = (
  script: string,
  env: NodeJS.ProcessEnv = process.env
): ReadonlyArray<TerminalCommand> => {
  const preferred = env.TERMINAL?.trim() ?? "";

  return [
    ...(preferred === "" ? [] : [{ file: preferred, args: ["-e", script] }]),
    { file: "x-terminal-emulator", args: ["-e", script] },
    { file: "gnome-terminal", args: ["--", script] },
    { file: "konsole", args: ["-e", script] },
    { file: "xfce4-terminal", args: ["-x", script] },
    { file: "xterm", args: ["-e", script] },
  ];
};

/** Runs the script `terminalScript` wrote in the first terminal emulator this Linux machine has. */
export const openLinuxTerminal = (
  script: string,
  start: (command: TerminalCommand) => Promise<boolean> = launch,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> =>
  startFirst(
    linuxTerminalCommands(script, env),
    start,
    "No terminal emulator found; set $TERMINAL to one."
  );

export interface ClientTerminalOptions {
  readonly env: NodeJS.ProcessEnv;
  /** Electron's `shell.openPath`: macOS opens a `.command` file in Terminal. Resolves to an error message, or "". */
  readonly openPath: (path: string) => Promise<string>;
  readonly start?: (command: TerminalCommand) => Promise<boolean>;
  readonly tmp?: string;
}

/**
 * Runs `argv` in a new terminal window on this Client: Windows Terminal or cmd, a `.command`
 * file in macOS Terminal, or a script in a Linux terminal emulator.
 */
export const openClientTerminal = async (
  argv: ReadonlyArray<string>,
  platform: NodeJS.Platform,
  { env, openPath, start = launch, tmp = tmpdir() }: ClientTerminalOptions
): Promise<void> => {
  if (platform === "win32") return openWindowsTerminal(argv, start, env);
  const mac = platform === "darwin";
  const dir = mkdtempSync(join(tmp, "polaris-terminal-"));
  const script = join(dir, mac ? "polaris.command" : "polaris.sh");

  writeFileSync(script, terminalScript(argv, !mac));
  chmodSync(script, 0o700);

  if (!mac) return openLinuxTerminal(script, start, env);
  const error = await openPath(script);

  if (error !== "") throw new Error(error);
};
