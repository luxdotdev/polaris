// Portions adapted from pingdotgg/t3code@66ee628e0875b2b735b199f42e6151e347833637 (MIT)
/**
 * The `tailscale` CLI: where it is, `status --json`, and `serve` on and off for one path. Its
 * stderr is classified, never quoted: it can hold auth keys (`tskey-…`) and node names.
 */
import { statSync } from "node:fs";
import { Effect, Option, Schema } from "effect";
import { findExecutable } from "../platform/executable.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** The CLI inside the macOS app (App Store or standalone) when none is on `PATH`. */
export const MACOS_APP_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

const STATUS_TIMEOUT_MS = 3_500;

const SERVE_TIMEOUT_MS = 10_000;

export interface TailscaleCli {
  readonly path: string;
  /** The app's binary acts as the CLI only with `TAILSCALE_BE_CLI=1`. */
  readonly env: Env;
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/** The CLI on the Daemon's `PATH`, else the macOS app's; null when Tailscale isn't installed. */
export const findTailscale = (
  env: Env = process.env,
  os: string = process.platform,
  exists: (path: string) => boolean = isFile
): TailscaleCli | null => {
  const onPath = findExecutable(os === "win32" ? "tailscale.exe" : "tailscale", env);

  if (onPath !== null) return { path: onPath, env };

  if (os === "darwin" && exists(MACOS_APP_CLI))
    return { path: MACOS_APP_CLI, env: { ...env, TAILSCALE_BE_CLI: "1" } };

  return null;
};

/** What a failed command's stderr says, as a label safe to log and show. */
export const StderrDiagnostic = Schema.Literals([
  "no-existing-handler",
  "not-logged-in",
  "not-running",
  "permission-denied",
  "https-disabled",
  "unknown",
]);

export type StderrDiagnostic = typeof StderrDiagnostic.Type;

const DIAGNOSTICS: ReadonlyArray<readonly [RegExp, Exclude<StderrDiagnostic, "unknown">]> = [
  [/handler does not exist/i, "no-existing-handler"],
  [/not logged in|logged out|needs? login/i, "not-logged-in"],
  [
    /failed to connect to local tailscale|is tailscale(d)? running|tailscaled.*not running/i,
    "not-running",
  ],
  [
    /access denied|permission denied|must be root|operation not permitted|--operator/i,
    "permission-denied",
  ],
  [/https.*not enabled|enable https|serve is not enabled/i, "https-disabled"],
];

export const diagnose = (stderr: string): StderrDiagnostic | null =>
  stderr.trim() === ""
    ? null
    : (DIAGNOSTICS.find(([pattern]) => pattern.test(stderr))?.[1] ?? "unknown");

export class TailscaleSpawnError extends Schema.TaggedError<TailscaleSpawnError>()(
  "TailscaleSpawnError",
  { subcommand: Schema.String }
) {}

export class TailscaleExitError extends Schema.TaggedError<TailscaleExitError>()(
  "TailscaleExitError",
  {
    subcommand: Schema.String,
    exitCode: Schema.Number,
    diagnostic: Schema.NullOr(StderrDiagnostic),
  }
) {}

export class TailscaleTimeoutError extends Schema.TaggedError<TailscaleTimeoutError>()(
  "TailscaleTimeoutError",
  { subcommand: Schema.String, timeoutMs: Schema.Number }
) {}

export class TailscaleParseError extends Schema.TaggedError<TailscaleParseError>()(
  "TailscaleParseError",
  { subcommand: Schema.String }
) {}

export type TailscaleCommandError =
  | TailscaleSpawnError
  | TailscaleExitError
  | TailscaleTimeoutError;

interface Finished {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const spawnAndWait = async (
  cli: TailscaleCli,
  args: ReadonlyArray<string>,
  timeoutMs: number
): Promise<Finished | "timeout"> => {
  // stdin is closed: `serve` waits on a prompt when HTTPS needs enabling.
  const child = Bun.spawn([cli.path, ...args], {
    env: { ...cli.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  const finished = Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).then(([stdout, stderr, exitCode]) => ({ exitCode, stdout, stderr }));

  try {
    const outcome = await Promise.race([finished, timedOut]);

    if (outcome === "timeout") child.kill("SIGKILL");

    return outcome;
  } finally {
    clearTimeout(timer);
  }
};

/** Runs `tailscale <args>`; stdout on success, a classified failure otherwise. */
export const runTailscale = Effect.fn("tailscale.run")(function* (
  cli: TailscaleCli,
  args: ReadonlyArray<string>,
  timeoutMs: number = STATUS_TIMEOUT_MS
) {
  const subcommand = args[0] ?? "";

  const outcome = yield* Effect.tryPromise({
    try: () => spawnAndWait(cli, args, timeoutMs),
    catch: () => new TailscaleSpawnError({ subcommand }),
  });

  if (outcome === "timeout") return yield* new TailscaleTimeoutError({ subcommand, timeoutMs });

  if (outcome.exitCode !== 0)
    return yield* new TailscaleExitError({
      subcommand,
      exitCode: outcome.exitCode,
      diagnostic: diagnose(outcome.stderr),
    });

  return outcome.stdout;
});

const StatusJson = Schema.Struct({
  BackendState: Schema.optional(Schema.String),
  Self: Schema.optional(
    Schema.Struct({
      DNSName: Schema.optional(Schema.String),
      CapMap: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
    })
  ),
});

const decodeStatus = Schema.decodeUnknownOption(Schema.fromJsonString(StatusJson));

export interface TailscaleStatus {
  /** `Running`, `Stopped`, `NeedsLogin`, `NeedsMachineAuth`, `Starting`, `NoState`. */
  readonly backendState: string | null;
  /** `<machine>.<tailnet>.ts.net`, without the trailing dot. */
  readonly magicDnsName: string | null;
  /**
   * `serve --https` needs the `https` capability, granted once the tailnet enables HTTPS
   * certificates. Null when the CLI reports no capability map (older CLI), so serve is tried.
   */
  readonly httpsEnabled: boolean | null;
}

export const parseStatus = (json: string): Option.Option<TailscaleStatus> =>
  Option.map(decodeStatus(json), (status) => {
    const dnsName = status.Self?.DNSName?.trim().replace(/\.$/u, "") ?? "";
    const capMap = status.Self?.CapMap;

    return {
      backendState: status.BackendState ?? null,
      magicDnsName: dnsName === "" ? null : dnsName,
      httpsEnabled: capMap === undefined || capMap === null ? null : Object.hasOwn(capMap, "https"),
    };
  });

export const readStatus = (cli: TailscaleCli) =>
  runTailscale(cli, ["status", "--json"]).pipe(
    Effect.flatMap((stdout) =>
      Option.match(parseStatus(stdout), {
        onNone: () => Effect.fail(new TailscaleParseError({ subcommand: "status" })),
        onSome: Effect.succeed,
      })
    )
  );

const ServeConfig = Schema.Struct({
  TCP: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        HTTP: Schema.optional(Schema.Boolean),
      })
    )
  ),
  AllowFunnel: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
  Web: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        Handlers: Schema.optional(
          Schema.Record(Schema.String, Schema.Struct({ Proxy: Schema.optional(Schema.String) }))
        ),
      })
    )
  ),
});

const ServeJson = Schema.Struct({
  ...ServeConfig.fields,
  Foreground: Schema.optional(Schema.Record(Schema.String, ServeConfig)),
});

const decodeServe = Schema.decodeUnknownOption(Schema.fromJsonString(ServeJson));

/** Neither a foreground owner nor an HTTP listener may be replaced by our HTTPS Serve. */
export const portInUse = (serve: typeof ServeJson.Type): boolean =>
  serve.TCP?.["443"]?.HTTP === true ||
  Object.values(serve.Foreground ?? {}).some(
    (foreground) =>
      foreground.TCP?.["443"] !== undefined ||
      Object.keys(foreground.Web ?? {}).some((host) => host.endsWith(":443"))
  );

/** A present handler can serve a file or text instead of a proxy. */
export const servedHandler = (serve: typeof ServeJson.Type, host: string, path: string) => {
  const handlers = serve.Web?.[`${host}:443`]?.Handlers;

  return handlers?.[path] ?? handlers?.[`${path}/`] ?? null;
};

export const funnelOn = (serve: typeof ServeJson.Type, host: string): boolean =>
  serve.AllowFunnel?.[`${host}:443`] === true;

/** Unreadable config is an error, never evidence that the path is off. */
export const readServe = (cli: TailscaleCli) =>
  runTailscale(cli, ["serve", "status", "--json"]).pipe(
    Effect.flatMap((stdout) =>
      Option.match(decodeServe(stdout), {
        onNone: () => Effect.fail(new TailscaleParseError({ subcommand: "serve" })),
        onSome: Effect.succeed,
      })
    )
  );

/** `serve --set-path` strips `path` before proxying, so the target names it again. */
export const serveOn = (cli: TailscaleCli, path: string, target: string) =>
  runTailscale(
    cli,
    ["serve", "--bg", "--https=443", "--set-path", path, target],
    SERVE_TIMEOUT_MS
  ).pipe(Effect.asVoid);

/** Removes only `path`; whatever else the user serves on 443 stays. Already off is fine. */
export const serveOff = (cli: TailscaleCli, path: string) =>
  runTailscale(cli, ["serve", "--https=443", "--set-path", path, "off"], SERVE_TIMEOUT_MS).pipe(
    Effect.asVoid,
    Effect.catchTag("TailscaleExitError", (error) =>
      error.diagnostic === "no-existing-handler" ? Effect.void : Effect.fail(error)
    )
  );
