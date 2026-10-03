import { Schema } from "effect";
import { isAbsolute } from "node:path";
import type { Tool } from "../catalog/model.ts";
import type { HostObservations, RequestGuard } from "./host.ts";
import { abortable, checkAbort, digest, failure } from "./validation.ts";

/** Captured independently by Core from the live principal and canonical checkout, never from trusted alone. */
export interface ObservationAdmission {
  readonly cwd: string;
  readonly requireCurrent: RequestGuard;
}

const Probe = Schema.Struct({
  id: Schema.String.check(Schema.isMaxLength(4096)),
  executable: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
  version: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
});

const Observation = Schema.Struct({
  connected: Schema.Boolean,
  probes: Schema.Array(Probe).check(Schema.isMaxLength(64)),
});

type Job = { task: Promise<HostObservations>; controller: AbortController; consumers: number };

/** Deduplicate only within one captured admission. The last cancelled consumer aborts owned work. */
export function createDemandObservations(options: {
  lifetime: AbortSignal;
  observe: (
    tool: Tool,
    phase: "install" | "feature",
    trusted: boolean,
    signal: AbortSignal,
    admission?: ObservationAdmission
  ) => Promise<HostObservations>;
}) {
  const admissions = new WeakMap<
    ObservationAdmission,
    { id: number; value: ObservationAdmission }
  >();

  const pending = new Map<string, Job>();
  let nextId = 0;
  let inspections = 0;

  function capture(admission?: ObservationAdmission) {
    if (!admission) return undefined;
    let captured = admissions.get(admission);

    if (
      captured &&
      (captured.value.cwd !== admission.cwd ||
        captured.value.requireCurrent !== admission.requireCurrent)
    )
      throw failure("conflict", "Captured observation authority cannot be rebound", true);

    if (!captured) {
      if (!isAbsolute(admission.cwd) || admission.cwd.includes("\0"))
        throw failure("invalid-input", "Observation requires a canonical checkout directory");
      captured = { id: ++nextId, value: Object.freeze({ ...admission }) };
      admissions.set(admission, captured);
    }

    return captured;
  }

  function start(
    tool: Tool,
    phase: "install" | "feature",
    trusted: boolean,
    admission?: ObservationAdmission
  ) {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, options.lifetime]);

    const timer = setTimeout(
      () => controller.abort(failure("timeout", "Host prerequisites could not be checked", true)),
      2000
    );

    const task = Promise.resolve()
      .then(async () => {
        checkAbort(signal);
        await admission?.requireCurrent(signal);
        checkAbort(signal);

        const result = await options.observe(
          structuredClone(tool),
          phase,
          trusted,
          signal,
          admission
        );

        checkAbort(signal);
        await admission?.requireCurrent(signal);
        checkAbort(signal);

        return Schema.decodeUnknownSync(Observation)(result);
      })
      .finally(() => {
        clearTimeout(timer);
      });

    return { task, controller, consumers: 0 };
  }

  async function observe(
    tool: Tool,
    phase: "install" | "feature",
    trusted: boolean,
    input: AbortSignal,
    admission?: ObservationAdmission
  ) {
    const signal = AbortSignal.any([input, options.lifetime]);
    checkAbort(signal);
    const captured = capture(admission);

    if (tool.requirements.length && !captured)
      throw failure(
        "not-ready",
        "Prerequisite observation is unavailable without current request authority",
        true
      );

    if (inspections >= 64)
      throw failure("queue-full", "Host observation consumer limit reached", true);
    inspections++;
    let job: Job | undefined;

    try {
      await abortable(captured?.value.requireCurrent(signal) ?? Promise.resolve(), signal);
      const key = `${digest(JSON.stringify(tool))}:${phase}:${trusted}:${captured?.id ?? 0}`;
      job = pending.get(key);

      if (!job) {
        if (pending.size >= 4) throw failure("queue-full", "Host observation limit reached", true);
        job = start(tool, phase, trusted, captured?.value);
        pending.set(key, job);
        void job.task.finally(() => pending.delete(key)).catch(() => undefined);
      }

      job.consumers++;
      const result = await abortable(job.task, AbortSignal.any([signal, job.controller.signal]));
      await abortable(captured?.value.requireCurrent(signal) ?? Promise.resolve(), signal);
      checkAbort(signal);

      return structuredClone(result);
    } finally {
      inspections--;

      if (job) {
        job.consumers--;

        if (!job.consumers) job.controller.abort();
      }
    }
  }

  return {
    observe,
    stats: () => ({ observations: pending.size, inspections }),
    async dispose() {
      await Promise.allSettled([...pending.values()].map((job) => job.task));
    },
  };
}
