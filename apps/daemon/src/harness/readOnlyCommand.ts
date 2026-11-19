/**
 * Whether a shell command plainly only reads (ADR 0117): the working tree isn't snapshotted
 * around those. An allowlist, so anything it can't follow counts as writing.
 */

/** Redirects, substitutions, variables, escapes, groups, comments and more than one line. */
const NOT_PLAIN = /[<>`$\\(){}#\n\r]/;

/** Where one command ends and the next starts. Also splits inside quotes, which only adds checks. */
const SEPARATORS = /&&|\|\||[;|]/;

type Check = (args: ReadonlyArray<string>) => boolean;

const always: Check = () => true;

/** No argument that is, or starts with, one of `flags`. */
const without =
  (...flags: ReadonlyArray<string>): Check =>
  (args) =>
    !args.some((arg) => flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)));

const FIND_ACTIONS = [
  "-delete",
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-fls",
];

/** git subcommands that leave the working tree alone, given first (no `-C`, no `-c`). */
const GIT_READS = new Set([
  "status",
  "log",
  "diff",
  "show",
  "rev-parse",
  "ls-files",
  "blame",
  "grep",
  "describe",
  "branch",
  "remote",
]);

const git: Check = ([subcommand, ...rest]) =>
  subcommand !== undefined && GIT_READS.has(subcommand) && without("--output")(rest);

const PLAIN = [
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "egrep",
  "fgrep",
  "pwd",
  "echo",
  "which",
  "cd",
  "true",
  "test",
  "[",
  "stat",
  "du",
  "df",
  "date",
  "whoami",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "cut",
  "tr",
  "nl",
  "jq",
  "diff",
  "cmp",
  "sleep",
];

const READS = new Map<string, Check>([
  ...PLAIN.map((name): [string, Check] => [name, always]),
  // `--pre` runs a command of its own on every file.
  ["rg", without("--pre")],
  ["sort", (args) => !args.some((arg) => arg.startsWith("-o") || arg.startsWith("--output"))],
  ["find", without(...FIND_ACTIONS)],
  ["git", git],
]);

/** stderr sent to stdout or dropped: the one redirect that writes no file. */
const STDERR_REDIRECT = /(^|\s)2>(&1|\/dev\/null)(?=$|[\s;|&])/g;

/** Whether every command in `command` is one that only reads, written plainly. */
export const isReadOnlyCommand = (command: string): boolean => {
  const plain = command.replace(STDERR_REDIRECT, "$1");

  if (NOT_PLAIN.test(plain)) return false;
  const commands = plain.split(SEPARATORS);

  // What is left of `&` after `&&` is a background job.
  return commands.every((part) => {
    if (part.includes("&")) return false;
    const [name, ...args] = part.trim().split(/\s+/);

    return name === undefined || name === ""
      ? commands.length === 1
      : READS.get(name)?.(args) === true;
  });
};
