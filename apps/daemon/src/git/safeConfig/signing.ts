/**
 * How an automatic git commit is signed: only the Host's own (system or global) config names
 * the key, format and program (docs/adr/0068-accepts-merge-signs-with-the-hosts-own-settings.md).
 */
import { isAbsolute } from "node:path";
import { type Entry, type Pair, REPOSITORY_SCOPES } from "./settings.ts";

/** Config git reads before a repository's own: system, global, and Apple's built-in (`unknown`). */
const HOST_SCOPES: ReadonlySet<string> = new Set(["system", "global", "unknown"]);

const FORMATS = ["openpgp", "x509", "ssh"] as const;

type Format = (typeof FORMATS)[number];

/** The keys git reads each format's program from, `gpg.program` being openpgp's older name. */
const PROGRAM_KEYS: Readonly<Record<Format, ReadonlyArray<string>>> = {
  openpgp: ["gpg.program", "gpg.openpgp.program"],
  x509: ["gpg.x509.program"],
  ssh: ["gpg.ssh.program"],
};

const DEFAULT_PROGRAM: Readonly<Record<Format, string>> = {
  openpgp: "gpg",
  x509: "gpgsm",
  ssh: "ssh-keygen",
};

const KEY_COMMAND = "gpg.ssh.defaultkeycommand";

export type Signing =
  | { readonly kind: "sign"; readonly pairs: ReadonlyArray<Pair> }
  | { readonly kind: "refuse"; readonly reason: string };

const isFormat = (value: string): value is Format => FORMATS.some((f) => f === value);

/** The last value git read for any of `keys` from the Host's own config. */
const hostValue = (entries: ReadonlyArray<Entry>, keys: ReadonlyArray<string>) =>
  entries.filter((e) => HOST_SCOPES.has(e.scope) && keys.includes(e.key)).at(-1)?.value;

/** A program named with a separator runs from the cwd, the repository; older gits don't expand `~`. */
const relativePath = (program: string) => /[/\\]/.test(program) && !isAbsolute(program);

/** An ssh key file relative to the repository: the repository would choose the key. */
const relativeKey = (format: Format, key: string | undefined) =>
  format === "ssh" && key !== undefined && !/^(key::|ssh-|~)/.test(key) && !isAbsolute(key);

interface Settings {
  readonly format: Format;
  readonly program: string;
  readonly key: string | undefined;
  readonly keyCommand: string | undefined;
}

/** What the repository's own config sets differently from the settings Polaris signs with. */
const repositoryDifference = (entries: ReadonlyArray<Entry>, settings: Settings) => {
  const used = new Map<string, string | undefined>([
    ["gpg.format", settings.format],
    ["user.signingkey", settings.key],
    ...PROGRAM_KEYS[settings.format].map((k): [string, string] => [k, settings.program]),
    ...(settings.format === "ssh" ? [[KEY_COMMAND, settings.keyCommand] as const] : []),
  ]);

  return entries.find(
    (e) => REPOSITORY_SCOPES.has(e.scope) && used.has(e.key) && used.get(e.key) !== e.value
  )?.key;
};

const settingsPairs = ({ format, program, key, keyCommand }: Settings): ReadonlyArray<Pair> => [
  ["gpg.format", format],
  ...PROGRAM_KEYS[format].map((k): Pair => [k, program]),
  ...(key === undefined ? [] : [["user.signingKey", key] as const]),
  ...(format === "ssh" && keyCommand !== undefined
    ? [["gpg.ssh.defaultKeyCommand", keyCommand] as const]
    : []),
];

/**
 * The settings that sign a commit from `entries` (git's own listing), to set after the safe
 * config's: refused when the repository's config would sign differently or name what runs.
 */
export const hostSigning = (entries: ReadonlyArray<Entry>): Signing => {
  const format = hostValue(entries, ["gpg.format"]) ?? "openpgp";

  if (!isFormat(format))
    return { kind: "refuse", reason: `your git config sets gpg.format to ${format}` };

  const settings: Settings = {
    format,
    program: hostValue(entries, PROGRAM_KEYS[format]) ?? DEFAULT_PROGRAM[format],
    key: hostValue(entries, ["user.signingkey"]),
    keyCommand: hostValue(entries, [KEY_COMMAND]),
  };

  const differs = repositoryDifference(entries, settings);

  if (differs !== undefined)
    return { kind: "refuse", reason: `this repository's own config sets ${differs}` };

  const command = settings.keyCommand?.trim().split(/\s+/)[0] ?? "";

  if (relativePath(settings.program) || relativePath(command))
    return { kind: "refuse", reason: "your git config names a signing program by a relative path" };

  if (relativeKey(format, settings.key))
    return { kind: "refuse", reason: "your git config names a signing key by a relative path" };

  return { kind: "sign", pairs: settingsPairs(settings) };
};
