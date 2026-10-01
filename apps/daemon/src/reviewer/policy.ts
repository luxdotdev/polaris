/**
 * What the Reviewer may run (ENG-222): reading, searching, `git diff`/`log`
 * and the like, and the repo's tests, lint and typecheck. Nothing that writes
 * a file or reaches the network; anything not listed is denied.
 */
import { ApprovalDecision, type HarnessKind } from "@polaris/protocol";
import type { PolicyRequest } from "../services.ts";
import { which } from "../service/userPath.ts";

const READ_COMMANDS = new Set([
  "cat",
  "head",
  "tail",
  "wc",
  "ls",
  "tree",
  "file",
  "stat",
  "grep",
  "egrep",
  "rg",
  "jq",
  "diff",
  "pwd",
  "echo",
  "true",
  "sort",
  "uniq",
  "cut",
  "nl",
]);

const GIT_READS = new Set([
  "diff",
  "log",
  "show",
  "status",
  "blame",
  "grep",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "merge-base",
  "cat-file",
  "shortlog",
  "describe",
  "name-rev",
  "range-diff",
]);

/** Script names that run tests, lint or typecheck through a package manager. */
const CHECK_SCRIPT = /^(test|tests|lint|typecheck|type-check|check|tsc|vitest|jest)(:[\w-]+)?$/;

const PACKAGE_MANAGERS = new Set(["bun", "npm", "pnpm", "yarn"]);

/** Each checker and the subcommands allowed; null allows any. */
const LANGUAGE_CHECKS = new Map<string, ReadonlySet<string> | null>([
  ["cargo", new Set(["test", "check", "clippy"])],
  ["go", new Set(["test", "vet"])],
  ["make", new Set(["test", "lint", "check", "typecheck"])],
  ["pytest", null],
  ["mypy", null],
  ["ruff", new Set(["check"])],
  ["tsc", null],
  ["eslint", null],
  ["oxlint", null],
  ["biome", new Set(["check", "lint"])],
]);

const FORBIDDEN_FLAGS = new Map<string, ReadonlyArray<string>>([
  ["find", ["-exec", "-execdir", "-delete", "-ok", "-okdir", "-fprint", "-fprintf", "-fls"]],
  ["git", ["--output", "-o", "--ext-diff"]],
  ["sort", ["-o", "--output"]],
  ["rg", ["--pre"]],
]);

/** Shell syntax that chains, redirects or substitutes: never allowed. */
const UNSAFE_SYNTAX = /[;&><`\n]|\$\(/;

/** Whitespace-split words with simple quotes removed; null on an unbalanced quote. */
export const words = (segment: string): ReadonlyArray<string> | null => {
  const out: Array<string> = [];
  const pattern = /'([^']*)'|"([^"$\\]*)"|(\S+)/g;

  for (const match of segment.matchAll(pattern)) {
    const word = match[1] ?? match[2] ?? match[3] ?? "";

    if (/["']/.test(word)) return null;
    out.push(word);
  }

  return out;
};

const runsCheckScript = (args: ReadonlyArray<string>): boolean => {
  const [first, second] = args;

  if (first === "test") return true;

  return (
    (first === "run" && second !== undefined && CHECK_SCRIPT.test(second)) ||
    (first !== undefined && first !== "run" && CHECK_SCRIPT.test(first))
  );
};

const hasForbiddenFlag = (command: string, args: ReadonlyArray<string>): boolean =>
  (FORBIDDEN_FLAGS.get(command) ?? []).some((flag) =>
    args.some(
      (arg) => arg === flag || arg.startsWith(`${flag}=`) || (flag === "-i" && arg.startsWith("-i"))
    )
  );

/** Reading, searching and read-only git. */
const readsOnly = (name: string, args: ReadonlyArray<string>): boolean => {
  if (READ_COMMANDS.has(name) || name === "find") return true;

  if (name === "sed") return args[0] === "-n" && /^[\d,$]+p$/.test(args[1] ?? "");

  if (name !== "git") return false;
  const sub = args.find((arg, i) => !arg.startsWith("-") && args[i - 1] !== "-C");

  return sub !== undefined && GIT_READS.has(sub) && !args.includes("-c");
};

/** The repo's tests, lint and typecheck; they can reach the network unless the Harness stops it. */
const runsCheck = (name: string, args: ReadonlyArray<string>): boolean => {
  if (PACKAGE_MANAGERS.has(name)) return runsCheckScript(args);

  if (LANGUAGE_CHECKS.has(name)) {
    const subcommands = LANGUAGE_CHECKS.get(name) ?? null;

    return subcommands === null || subcommands.has(args[0] ?? "");
  }

  return (
    (name === "python" || name === "python3") &&
    args[0] === "-m" &&
    (args[1] === "pytest" || args[1] === "mypy")
  );
};

const allowedWords = (all: ReadonlyArray<string>, runChecks: boolean): boolean => {
  const [command, ...args] = all;

  if (command === undefined) return false;
  const name = command.split("/").at(-1) ?? command;

  if (hasForbiddenFlag(name, args)) return false;

  if (name === "npx" || name === "bunx") return runChecks && allowedWords(args, runChecks);

  return readsOnly(name, args) || (runChecks && runsCheck(name, args));
};

/** `bash -lc '<script>'` and the like: the script, else null. */
const unwrapShell = (all: ReadonlyArray<string>): string | null => {
  const name = all[0]?.split("/").at(-1);

  if (name !== "bash" && name !== "sh" && name !== "zsh") return null;

  return all.length === 3 && /^-l?c$/.test(all[1] ?? "") ? (all[2] ?? null) : null;
};

/**
 * True when every piped segment of a command line is allowed; tests, lint and
 * typecheck only with `runChecks` (the Harness keeps them off the network).
 */
export const isAllowedCommand = (line: string, runChecks = true): boolean => {
  const trimmed = line.trim();
  const whole = words(trimmed);
  const script = whole === null ? null : unwrapShell(whole);

  if (script !== null) return isAllowedCommand(script, runChecks);

  if (trimmed === "" || UNSAFE_SYNTAX.test(trimmed)) return false;

  return trimmed.split("|").every((segment) => {
    const parts = words(segment.trim());

    return parts !== null && allowedWords(parts, runChecks);
  });
};

/** Where each driver puts the command line: Claude in `detail`, Codex in `title`. */
const commandLine = (harness: HarnessKind, request: PolicyRequest): string | null =>
  harness === "codex" ? request.title : request.detail;

const deny = (reason: string) => ApprovalDecision.cases.Deny.make({ reason });

/**
 * Whether the Reviewer may run checks on this Harness: Codex's read-only
 * sandbox has no network; Claude Code's sandbox needs bubblewrap and socat on Linux.
 */
export const canRunChecks = (harness: HarnessKind, platform = process.platform): boolean => {
  if (harness === "codex") return true;

  if (harness !== "claude") return false;

  if (platform === "darwin") return true;

  return platform === "linux" && which("bwrap") !== null && which("socat") !== null;
};

/** The Reviewer's answer to an approval: never null, since nobody else is asked. */
export const reviewerDecision = (
  request: PolicyRequest,
  options: { readonly runChecks: boolean }
): ApprovalDecision => {
  if (request.kind === "question") {
    return ApprovalDecision.cases.Answer.make({
      text: "Nobody can answer during a review: decide from the code, and say what you assumed.",
    });
  }

  if (request.kind !== "command") {
    return deny("The Reviewer is read-only: it can't edit files or use that tool.");
  }

  const line = commandLine(request.harness, request);

  if (line !== null && isAllowedCommand(line, options.runChecks)) {
    return ApprovalDecision.cases.Allow.make({ remember: false });
  }

  return deny(
    options.runChecks
      ? "The Reviewer may only read, search, run git diff/log/show and the repo's tests, lint and typecheck."
      : "The Reviewer may only read, search and run git diff/log/show here: tests can't run without network isolation on this Host."
  );
};
