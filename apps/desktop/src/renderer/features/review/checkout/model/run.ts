/**
 * What "Run" starts in a Review Checkout (Paper R4/R5): the checkout's own `dev` script, else
 * `start`, with the package manager its lockfile names. Pure; `../run.ts` reads the files.
 */
import { Option, Schema } from "effect";

/** Lockfiles in the order they decide the package manager. */
export const LOCKFILES: ReadonlyArray<readonly [string, string]> = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/** Scripts tried, in order. */
const SCRIPTS = ["dev", "start"] as const;

const PackageJson = Schema.Struct({
  scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

const decodePackage = Schema.decodeUnknownOption(Schema.fromJsonString(PackageJson));

/** `bun run dev`, `npm run start`…; null when the checkout has neither script. */
export const runCommandOf = (
  packageJson: string | null,
  present: ReadonlySet<string>
): string | null => {
  if (packageJson === null) return null;

  const scripts: Readonly<Record<string, string>> = Option.match(decodePackage(packageJson), {
    onNone: () => ({}),
    onSome: (pkg) => pkg.scripts ?? {},
  });

  const script = SCRIPTS.find((name) => scripts[name] !== undefined);

  if (script === undefined) return null;

  const manager = LOCKFILES.find(([file]) => present.has(file))?.[1] ?? "npm";

  return `${manager} run ${script}`;
};

/**
 * The command through the user's login shell, so it finds what their PATH has (a Daemon
 * started by launchd or systemd has a bare one).
 */
export const loginShellArgv = (command: string): ReadonlyArray<string> => [
  "/bin/sh",
  "-c",
  'exec "${SHELL:-/bin/sh}" -lc "$0"',
  command,
];

/** "bun run dev · 2m". */
export const runningFact = (command: string, seconds: number) =>
  seconds < 60 ? command : `${command} · ${Math.floor(seconds / 60)}m`;
