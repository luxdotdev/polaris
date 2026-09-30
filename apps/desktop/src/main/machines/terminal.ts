/**
 * The fallback hand-off to macOS Terminal: `ssh <alias>` to trust a host key
 * when the local Host is off (the in-app terminal runs on a Daemon). Polaris
 * never answers the prompt itself (ENG-179).
 */
import { shellQuote } from "@polaris/client/install";

/** The script Terminal runs: the command, then a pause so its output stays readable. */
export const terminalScript = (argv: ReadonlyArray<string>): string =>
  [
    "#!/bin/sh",
    `${argv.map(shellQuote).join(" ")}`,
    'printf "\\n[Polaris: done. Close this window, then retry in Polaris.]\\n"',
    "",
  ].join("\n");

/** `ssh <alias>`, interactive, so ssh can ask to trust the key or for a password. */
export const sshArgv = (alias: string): ReadonlyArray<string> => ["ssh", "--", alias];
