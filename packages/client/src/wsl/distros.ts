/**
 * The WSL distros on this Windows machine, from `wsl.exe --list --verbose`.
 * Parsed by columns from the right (state, version), so a localized header or
 * state word still yields the name; the first line is always the header.
 * UNVERIFIED on real WSL: only the fake `wsl.exe` (fakeWsl.testing.ts) ran it.
 */
import { Data, Effect, Schema } from "effect";
import { type ChildProcessApi, childProcesses } from "../process/index.ts";
import { decodeWslOutput, wslEnv } from "./output.ts";

export const WslDistroState = Schema.Literals(["running", "stopped", "unknown"]);

export type WslDistroState = typeof WslDistroState.Type;

export class WslDistro extends Schema.Class<WslDistro>("WslDistro")({
  name: Schema.String,
  /** 1 or 2; only WSL 2 distros can be Hosts (a WSL 1 distro has no real kernel for Bun). */
  version: Schema.Number,
  state: WslDistroState,
  isDefault: Schema.Boolean,
}) {}

/** What asking `wsl.exe` for its distros found. */
export type WslDiscovery = Data.TaggedEnum<{
  Distros: { readonly distros: ReadonlyArray<WslDistro> };
  /** WSL answers but has no distro: "wsl --install -d Ubuntu" is the user's step. */
  NoDistros: Record<never, never>;
  /** No `wsl.exe`, or the stub that says WSL is not installed. */
  NotInstalled: { readonly detail: string };
  /** Not Windows: WSL never exists here. */
  Unsupported: Record<never, never>;
  Failed: { readonly detail: string };
}>;

export const WslDiscovery = Data.taggedEnum<WslDiscovery>();

/** Docker Desktop's helper distros are not Hosts; the user never sees them. */
export const HIDDEN_DISTROS: ReadonlySet<string> = new Set([
  "docker-desktop",
  "docker-desktop-data",
]);

const STATES: ReadonlyArray<readonly [RegExp, WslDistroState]> = [
  [/^(running|wird ausgeführt|en cours|en ejecución)$/i, "running"],
  [/^(stopped|beendet|arrêté|detenido)$/i, "stopped"],
];

const stateOf = (word: string): WslDistroState =>
  STATES.find(([pattern]) => pattern.test(word))?.[1] ?? "unknown";

const parseLine = (line: string): WslDistro | null => {
  const isDefault = line.startsWith("*");

  const columns = line
    .replace(/^\*/, "")
    .trim()
    .split(/\s{2,}/);

  if (columns.length < 3) return null;
  const version = Number(columns.at(-1));
  const state = columns.at(-2) ?? "";
  const name = columns.slice(0, -2).join("  ");

  if (!Number.isInteger(version) || name === "") return null;

  return new WslDistro({ name, version, state: stateOf(state), isDefault });
};

/** Parses the text of `wsl.exe -l -v`; the header line is skipped, blank lines ignored. */
export const parseDistroList = (text: string): ReadonlyArray<WslDistro> =>
  text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .slice(1)
    .flatMap((line) => {
      const distro = parseLine(line);

      return distro === null ? [] : [distro];
    });

export const NOT_INSTALLED_PATTERN =
  /is not installed|not enabled|wsl\.exe --install|Windows Subsystem for Linux has no installed|has no installed distributions/i;

export interface DiscoverOptions {
  /** `wsl.exe` by default; tests point this at the fake. */
  readonly wslBinary?: string;
  readonly env?: Record<string, string | undefined>;
  /** `process.platform` by default; off Windows the answer is `Unsupported` without spawning. */
  readonly platform?: NodeJS.Platform | undefined;
  readonly timeoutMs?: number;
  /** Starts `wsl.exe` (`ChildProcess`); tests script it. */
  readonly processes?: ChildProcessApi;
}

export const DEFAULT_WSL_BINARY = "wsl.exe";

interface RawResult {
  readonly code: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly spawnError: NodeJS.ErrnoException | null;
}

const concat = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;

  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }

  return out;
};

const runList = (
  binary: string,
  env: Record<string, string | undefined>,
  timeoutMs: number,
  processes: ChildProcessApi
) =>
  Effect.callback<RawResult>((resume) => {
    const child = processes.spawn({
      file: binary,
      args: ["--list", "--verbose"],
      env: wslEnv(env),
    });

    const stdout: Array<Uint8Array> = [];
    const stderr: Array<Uint8Array> = [];
    let spawnError: NodeJS.ErrnoException | null = null;
    child.stdout?.on("data", (chunk: Uint8Array) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Uint8Array) => stderr.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => (spawnError = error));
    child.on("close", (code) =>
      resume(Effect.succeed({ code, stdout: concat(stdout), stderr: concat(stderr), spawnError }))
    );
    const timer = setTimeout(() => child.kill(), timeoutMs);

    return Effect.sync(() => {
      clearTimeout(timer);
      child.kill();
    });
  });

/** Classifies a finished `wsl.exe --list --verbose`; pure, so tests cover every answer. */
export const discoveryOf = (result: RawResult): WslDiscovery => {
  if (result.spawnError !== null) {
    return WslDiscovery.NotInstalled({
      detail: `${DEFAULT_WSL_BINARY}: ${result.spawnError.code ?? result.spawnError.message}`,
    });
  }

  const out = decodeWslOutput(result.stdout);
  const err = decodeWslOutput(result.stderr);
  const text = `${out}\n${err}`;

  if (/has no installed distributions/i.test(text)) return WslDiscovery.NoDistros();

  if (NOT_INSTALLED_PATTERN.test(text)) {
    return WslDiscovery.NotInstalled({ detail: text.trim().split(/\r?\n/)[0] ?? "" });
  }

  if (result.code !== 0) {
    return WslDiscovery.Failed({ detail: text.trim() || `wsl.exe exited with ${result.code}` });
  }

  const distros = parseDistroList(out).filter((d) => !HIDDEN_DISTROS.has(d.name));

  return distros.length === 0 ? WslDiscovery.NoDistros() : WslDiscovery.Distros({ distros });
};

/** Asks `wsl.exe` for the distros; never fails, every outcome is a `WslDiscovery`. */
export const discoverDistros = (options: DiscoverOptions = {}): Effect.Effect<WslDiscovery> => {
  if ((options.platform ?? process.platform) !== "win32") {
    return Effect.succeed(WslDiscovery.Unsupported());
  }

  return Effect.map(
    runList(
      options.wslBinary ?? DEFAULT_WSL_BINARY,
      options.env ?? process.env,
      options.timeoutMs ?? 15_000,
      options.processes ?? childProcesses
    ),
    discoveryOf
  );
};
