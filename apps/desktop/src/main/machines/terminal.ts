/**
 * Hand-offs to the user's own Terminal: `ssh <alias>` to accept a host key or
 * see an auth prompt, and a Harness's own sign-in on a Host. Polaris never
 * answers those prompts itself (ADR 0001, ENG-179).
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

/** A command run on `alias` in a terminal (`ssh -t`); null alias runs it on this Mac. */
export const onHostArgv = (
  alias: string | null,
  argv: ReadonlyArray<string>
): ReadonlyArray<string> =>
  alias === null ? argv : ["ssh", "-t", "--", alias, argv.map(shellQuote).join(" ")];
