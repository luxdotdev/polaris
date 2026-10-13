/**
 * The `wsl.exe` command lines a Client runs against a WSL 2 distro, in place
 * of `ssh <alias> …`: `wsl.exe --distribution <distro> --exec /bin/sh -c <script>`.
 * `--exec` skips the distro's login shell, so argv reaches `sh` untouched and
 * `$HOME` is the distro user's home. UNVERIFIED on real WSL (docs/adr/0034-wsl-hosts.md).
 */
import { BRIDGE_EXIT_NO_DAEMON } from "@polaris/protocol";
import { ConnectFailure, classifyExit } from "../failures.ts";
import { DEFAULT_REMOTE_COMMAND } from "../ssh.ts";

export { DEFAULT_WSL_BINARY } from "./distros.ts";

export interface WslOptions {
  /** `wsl.exe` by default (Windows resolves it from System32); tests point this at a fake. */
  readonly wslBinary?: string;
  /** The remote command; default `DEFAULT_REMOTE_COMMAND`, the installed Daemon. */
  readonly remoteCommand?: ReadonlyArray<string>;
}

const DEFAULT_BINARY = "wsl.exe";

/** `wsl.exe -d <distro> --exec <argv…>`: runs `argv` in the distro as its default user. */
export const wslExecArgv = (
  distro: string,
  argv: ReadonlyArray<string>,
  options: WslOptions = {}
): Array<string> => [
  options.wslBinary ?? DEFAULT_BINARY,
  "--distribution",
  distro,
  "--exec",
  ...argv,
];

/** `argv` as one `sh -c` line: `~` and `$HOME` expand in the distro, like ssh's login shell. */
export const shellLine = (argv: ReadonlyArray<string>): string => argv.join(" ");

/** The bridge command: `exec` keeps the Daemon's stdio relay as the only process wsl.exe tracks. */
export const wslBridgeArgv = (distro: string, options: WslOptions = {}): Array<string> =>
  wslExecArgv(
    distro,
    ["/bin/sh", "-c", `exec ${shellLine(options.remoteCommand ?? DEFAULT_REMOTE_COMMAND)}`],
    options
  );

/** `wsl.exe -d <distro>`: an interactive shell, for a terminal window. */
export const wslShellArgv = (distro: string, options: WslOptions = {}): Array<string> => [
  options.wslBinary ?? DEFAULT_BINARY,
  "--distribution",
  distro,
];

/** The path Explorer shows for a file inside the distro: `\\wsl.localhost\<distro>\home\…`. */
export const wslWindowsPath = (distro: string, linuxPath: string): string =>
  `\\\\wsl.localhost\\${distro}${linuxPath.replaceAll("/", "\\")}`;

const needs = (reason: ConnectFailure["reason"], detail: string) =>
  new ConnectFailure({ kind: "needs-attention", reason, detail });

export const DISTRO_MISSING_PATTERN =
  /no distribution with the supplied name|WSL_E_DISTRO_NOT_FOUND|Wsl\/Service\/WSL_E_DISTRO_NOT_FOUND/i;

export const WSL_MISSING_PATTERN =
  /is not installed|not enabled|wsl\.exe --install|WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED|Windows Subsystem for Linux has no installed/i;

/**
 * Classifies how `wsl.exe … polaris bridge` ended. wsl.exe's own failures
 * come first; anything else is what `polaris bridge` or `sh` said.
 */
export const classifyWslExit = (exit: {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stderr: string;
}): ConnectFailure => {
  const stderr = exit.stderr.replaceAll("\u0000", "");
  const firstLine = stderr.trim().split(/\r?\n/)[0] ?? "";

  if (exit.code === BRIDGE_EXIT_NO_DAEMON) return classifyExit({ ...exit, stderr });

  if (DISTRO_MISSING_PATTERN.test(stderr)) return needs("wsl-distro-missing", firstLine);

  if (WSL_MISSING_PATTERN.test(stderr)) return needs("wsl-missing", firstLine);

  return classifyExit({ ...exit, stderr });
};
