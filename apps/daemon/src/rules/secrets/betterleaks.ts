/**
 * Runs Betterleaks (the pinned binary beside `polaris`) and reads its v2 JSON
 * report. Secrets never leave this module: each match is fingerprinted and
 * masked as soon as the report is parsed, and only the masked form is
 * returned. `--redact` is not used: it also rewrites file paths (rules-layer.md §5).
 *
 * Validation and analysis (`-v`/`-a`) stay off: they send a found credential
 * to its provider. The child gets a minimal environment, so neither a
 * `BETTERLEAKS_*` variable nor a token in the Daemon's environment reaches it.
 */
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { Schema } from "effect";
import { cachedBetterleaks, hostAsset } from "./fetch.ts";
import { maskSecret } from "./mask.ts";
import configImport from "./polaris-secrets.toml" with { type: "text" };

export const Confidence = Schema.Literals(["high", "medium", "low", ""]);

export type Confidence = typeof Confidence.Type;

const Report = Schema.Struct({
  schema_version: Schema.Literal("1"),
  findings: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        rule_id: Schema.String,
        rule_hash: Schema.String,
        description: Schema.String,
        confidence: Schema.optional(Confidence),
        match: Schema.Struct({ value: Schema.String, fingerprint: Schema.String }),
        location: Schema.Struct({
          path: Schema.String,
          start_line: Schema.Int,
          end_line: Schema.Int,
        }),
      })
    )
  ),
  scan: Schema.Struct({ state: Schema.String, betterleaks_version: Schema.String }),
});

/** Bun types TOML imports as `any`; with `type: "text"` it is the file's text. */
const configText: unknown = configImport;

const config = Schema.decodeUnknownSync(Schema.String)(configText);

const decodeReport = Schema.decodeUnknownSync(Schema.fromJsonString(Report));

/** One secret, as the Rules keep it: never the value itself. */
export interface SecretHit {
  readonly ruleId: string;
  readonly ruleHash: string;
  readonly description: string;
  readonly confidence: Confidence;
  /** SHA-256 of the secret, from Betterleaks. */
  readonly fingerprint: string;
  readonly masked: string;
  /** Relative to the scanned directory or repository. */
  readonly path: string;
  readonly start: number;
  readonly end: number;
}

export interface SecretScan {
  readonly hits: ReadonlyArray<SecretHit>;
  /** `complete`, or `incomplete` when Betterleaks stopped early. */
  readonly state: string;
  readonly version: string;
}

/**
 * The binary to run: `POLARIS_BETTERLEAKS` if set, else the one beside the
 * compiled `polaris`, else (from source) the cached download. Null when missing.
 */
export const locateBetterleaks = (): string | null => {
  const override = process.env.POLARIS_BETTERLEAKS;

  if (override !== undefined && override !== "") return existsSync(override) ? override : null;

  if (import.meta.path.startsWith("/$bunfs/")) {
    const beside = join(dirname(process.execPath), "betterleaks");

    return existsSync(beside) ? beside : null;
  }

  const asset = hostAsset();
  const cached = asset === null ? null : cachedBetterleaks(asset);

  return cached !== null && existsSync(cached) ? cached : null;
};

/** What the child may see of the Daemon's environment. */
const childEnv = () => {
  const keep = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "SSH_AUTH_SOCK"];

  return {
    ...Object.fromEntries(
      keep.flatMap((name) => {
        const value = process.env[name];

        return value === undefined ? [] : [[name, value]];
      })
    ),
    LC_ALL: "C",
    BETTERLEAKS_CONFIG_TOML: config,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    // Never run a repository's hooks or fsmonitor from a scan (`git log` in git mode).
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
    GIT_CONFIG_KEY_1: "core.fsmonitor",
    GIT_CONFIG_VALUE_1: "false",
  };
};

/** Detection workers: fewer than the default (4 × cores) keeps a Pi's peak memory down. */
const jobs = () => String(Math.min(8, Math.max(2, availableParallelism())));

/** The source, as Betterleaks' CLI takes it. */
export type SecretSource =
  | { readonly kind: "history"; readonly base: string; readonly head: string }
  | { readonly kind: "files" };

const sourceArgs = (source: SecretSource): ReadonlyArray<string> =>
  source.kind === "history"
    ? ["git", ".", `--log-opts=${source.base}..${source.head}`]
    : ["fs", ".", "--max-target-megabytes=10"];

const relative = (path: string) => (path.startsWith("./") ? path.slice(2) : path);

/** Runs a scan in `cwd`: commits `base..head` of its repository, or every file under it. */
export const scanSecrets = async (
  binary: string,
  cwd: string,
  source: SecretSource,
  signal: AbortSignal
): Promise<SecretScan> => {
  const proc = Bun.spawn(
    [
      binary,
      ...sourceArgs(source),
      "--output=-",
      "--no-banner",
      "--no-color",
      "--exit-code=0",
      "--log-level=error",
      `--jobs=${jobs()}`,
    ],
    {
      cwd,
      env: childEnv(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal,
    }
  );

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (code !== 0) throw new Error(`betterleaks exited ${code}: ${stderr.trim()}`);
  const report = decodeReport(stdout);

  return {
    state: report.scan.state,
    version: report.scan.betterleaks_version,
    hits: (report.findings ?? []).map((finding) => ({
      ruleId: finding.rule_id,
      ruleHash: finding.rule_hash,
      description: finding.description,
      confidence: finding.confidence ?? "",
      fingerprint: finding.match.fingerprint,
      masked: maskSecret(finding.match.value),
      path: relative(finding.location.path),
      start: finding.location.start_line,
      end: finding.location.end_line,
    })),
  };
};
