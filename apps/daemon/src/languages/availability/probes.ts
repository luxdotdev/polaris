import { access, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { Schema } from "effect";
import type { Requirement } from "../catalog/model.ts";
import type { ProbeFact } from "../catalog/selection.ts";
import type { ObservationAdmission, RequestGuard } from "../install/host.ts";
import { abortable, checkAbort, failure } from "../install/validation.ts";

export interface VersionCommand {
  readonly executable: string;
  readonly argv: ReadonlyArray<string>;
  readonly cwd: string;
}

export interface VersionOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface VersionProbe {
  readonly argv: ReadonlyArray<string>;
  /** Explicit runtime-specific parser; no guessed version or inferred capability on unknown output. */
  readonly parse: (output: VersionOutput) => string | null;
}

const Output = Schema.Struct({
  exitCode: Schema.Int,
  stdout: Schema.String.check(Schema.isMaxLength(4096)),
  stderr: Schema.String.check(Schema.isMaxLength(4096)),
});

async function locate(
  requirement: Requirement,
  configured: Readonly<Record<string, string>>,
  searchPath: ReadonlyArray<string>,
  signal: AbortSignal
) {
  const override = configured[requirement.id];

  if (override === undefined && !/^[A-Za-z0-9._+-]+$/.test(requirement.executable)) return null;

  const candidates =
    override !== undefined
      ? [override]
      : searchPath
          .slice(0, 32)
          .flatMap((directory) =>
            isAbsolute(directory) ? [join(directory, requirement.executable)] : []
          );

  for (const candidate of candidates) {
    checkAbort(signal);

    if (!isAbsolute(candidate) || candidate.includes("\0")) continue;

    try {
      const path = await realpath(candidate);

      if (!(await stat(path)).isFile()) continue;
      await access(path, constants.X_OK);

      return path;
    } catch {
      continue;
    }
  }

  return null;
}

function observationAuthority(guard: RequestGuard | undefined, cwd: string | undefined) {
  if (!guard || !cwd || !isAbsolute(cwd) || cwd.includes("\0"))
    throw failure("not-ready", "Prerequisite observation requires current request authority", true);

  return { guard, cwd };
}

/** Existing developer executables only; trust is rechecked before/after every bounded version command. */
export function runtimeProbeAdapter(options: {
  configured: Readonly<Record<string, string>>;
  searchPath: ReadonlyArray<string>;
  cwd?: string;
  versions: Readonly<Record<string, VersionProbe>>;
  requireCurrent?: RequestGuard;
  run: (command: VersionCommand, signal: AbortSignal) => Promise<VersionOutput>;
}) {
  const configured = structuredClone(options.configured);
  const searchPath = [...options.searchPath];

  const versions = Object.fromEntries(
    Object.entries(options.versions).map(([id, value]) => [
      id,
      { argv: [...value.argv], parse: value.parse },
    ])
  );

  const run = options.run;
  const lifetime = new AbortController();
  const running = new Set<Promise<VersionOutput>>();
  let active = 0;

  const probe = async (
    requirements: ReadonlyArray<Requirement>,
    trusted: boolean,
    inputSignal: AbortSignal,
    admission?: ObservationAdmission
  ): Promise<ReadonlyArray<ProbeFact>> => {
    const signal = AbortSignal.any([inputSignal, lifetime.signal]);
    checkAbort(signal);

    if (requirements.length > 64) throw failure("too-large", "Too many runtime prerequisites");

    if (!requirements.length) return [];

    if (!trusted) return requirements.map(({ id }) => ({ id, executable: null, version: null }));

    const { guard, cwd } = observationAuthority(
      admission?.requireCurrent ?? options.requireCurrent,
      admission?.cwd ?? options.cwd
    );

    if (active >= 4) throw failure("queue-full", "Runtime probe limit reached", true);
    active++;
    const facts: ProbeFact[] = [];

    try {
      for (const requirement of requirements) {
        await abortable(guard(signal), signal);
        const executable = await locate(requirement, configured, searchPath, signal);
        const spec = versions[requirement.id];
        let version: string | null = null;

        if (executable && spec) {
          const controller = new AbortController();
          const abort = () => controller.abort();
          signal.addEventListener("abort", abort, { once: true });

          const timer = setTimeout(
            () => controller.abort(failure("timeout", "Runtime version probe timed out", true)),
            1500
          );

          try {
            await abortable(guard(signal), signal);
            checkAbort(controller.signal);
            const task = run({ executable, argv: spec.argv, cwd }, controller.signal);
            running.add(task);
            let result: VersionOutput;

            try {
              result = await task;
            } finally {
              running.delete(task);
            }

            checkAbort(controller.signal);
            const output = Schema.decodeUnknownSync(Output)(result);
            await abortable(guard(signal), signal);

            if (output.exitCode === 0) version = spec.parse(output);

            if (version !== null && version.length > 4096) version = null;
          } finally {
            clearTimeout(timer);
            controller.abort();
            signal.removeEventListener("abort", abort);
          }
        }

        await abortable(guard(signal), signal);
        facts.push({ id: requirement.id, executable, version });
      }

      return facts;
    } finally {
      active--;
    }
  };

  return Object.assign(probe, {
    async dispose() {
      lifetime.abort();
      await Promise.allSettled(running);
    },
  });
}
