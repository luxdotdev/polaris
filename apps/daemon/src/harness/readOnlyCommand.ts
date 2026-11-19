/**
 * Whether a shell command plainly only reads (ADR 0117): the working tree isn't snapshotted
 * around those. An allowlist, so anything it can't follow counts as writing.
 */

/** Redirects, substitutions, variables, escapes, groups, comments and more than one line. */
const NOT_PLAIN = /[<>`$\\(){}#\n\r]/;

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
  // `-o` also hides in a cluster of short flags (`-uo out`).
  ["sort", (args) => !args.some((arg) => /^-[^-]*o/.test(arg) || arg.startsWith("--output"))],
  ["find", without(...FIND_ACTIONS)],
  ["git", git],
]);

/** stderr sent to stdout or dropped: the one redirect that writes no file. */
const STDERR_REDIRECT = /(^|\s)2>(&1|\/dev\/null)(?=$|[\s;|&])/g;

/** A quoted stretch, an operator, a run of spaces, or a run of anything else. */
const TOKENS = /'[^']*'|"[^"]*"|&&|\|\||[;|&]|\s+|[^\s'";|&]+/g;

const OPERATOR = /^(&&|\|\||[;|&]|\s+)$/;

/** What `token` adds to the word it is in; null for an operator or spaces, which end the word. */
const textOf = (token: string): string | null => {
  if (token.startsWith("'") || token.startsWith('"')) return token.slice(1, -1);

  return OPERATOR.test(token) ? null : token;
};

/**
 * The commands of `line`, each as its words with their quotes removed, as the shell passes
 * them: `'-delete'` is `-delete`. Null for a quote left open or a background job (`&`).
 */
const commandsOf = (line: string): Array<Array<string>> | null => {
  // The space ends the last word.
  const tokens: ReadonlyArray<string> = `${line} `.match(TOKENS) ?? [];

  // A quote left open is no token.
  if (tokens.join("").length !== line.length + 1 || tokens.includes("&")) return null;
  const commands: Array<Array<string>> = [[]];
  let word: string | null = null;

  for (const token of tokens) {
    const text = textOf(token);

    if (text !== null) {
      word = (word ?? "") + text;
      continue;
    }

    if (word !== null) commands.at(-1)!.push(word);
    word = null;

    if (token.trim() !== "") commands.push([]);
  }

  return commands;
};

/** Whether every command in `command` is one that only reads, written plainly. */
export const isReadOnlyCommand = (command: string): boolean => {
  const plain = command.replace(STDERR_REDIRECT, "$1");

  if (NOT_PLAIN.test(plain)) return false;
  const commands = commandsOf(plain);

  if (commands === null) return false;

  return commands.every(([name, ...args]) =>
    name === undefined ? commands.length === 1 : READS.get(name)?.(args) === true
  );
};
