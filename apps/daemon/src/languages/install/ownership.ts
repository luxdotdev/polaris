import { LanguageError, LanguageKey, LanguageText } from "@polaris/protocol";
import { Schema } from "effect";
import type { HostInstallation, ObservationAdmission, RequestGuard } from "./host.ts";
import type { InstallHandle, Progress } from "./types.ts";
import { ownedProgress } from "./owned-progress.ts";
import { abortable, checkAbort, failure } from "./validation.ts";

const InstallDemand = Schema.Struct({
  toolId: LanguageKey,
  version: LanguageText,
  intent: Schema.Literals(["encounter", "install", "update", "rollback"]),
  retainedIdentity: Schema.optional(Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/))),
});

export type OwnedInstallRequest = typeof InstallDemand.Type;

export interface InstallAction {
  readonly operation: "install" | "cancel" | "watch";
  readonly request: OwnedInstallRequest;
  readonly jobId?: string;
}

/** Core supplies an independently authenticated connection object and explicit action grants. */
export interface InstallOwnerAuthority {
  readonly principal: object;
  readonly lifetime: AbortSignal;
  readonly requireCurrent: RequestGuard;
  readonly authorize: (action: InstallAction, signal: AbortSignal) => Promise<void>;
}

export interface InstallOwnerPort {
  start(
    request: OwnedInstallRequest,
    admission?: ObservationAdmission,
    signal?: AbortSignal
  ): Promise<{ jobId: string }>;
  cancel(jobId: string, signal?: AbortSignal): Promise<void>;
  watch(
    jobId: string,
    signal?: AbortSignal
  ): Promise<{
    updates: AsyncIterableIterator<Progress, undefined, unknown>;
    dispose: () => Promise<void>;
  }>;
  stats(): { retained: number; pending: number; handles: number; sealed: boolean };
  dispose(): Promise<void>;
}

type Session = { port: InstallOwnerPort; publish: (progress: Progress) => void };

type Watch = ReturnType<typeof ownedProgress>;

interface Entry {
  readonly request: OwnedInstallRequest;
  readonly handles: Set<InstallHandle>;
  readonly admission: ObservationAdmission | undefined;
  readonly watches: Set<Watch>;
  latest: Progress | null;
  error: LanguageError | undefined;
  settled: boolean;
}

function rollbackIdentity(request: OwnedInstallRequest) {
  if (request.retainedIdentity === undefined)
    throw failure("not-installed", "Exact rollback identity is required");

  return request.retainedIdentity;
}

const normalize = (cause: unknown) =>
  Schema.is(LanguageError)(cause)
    ? cause
    : failure("install-failed", "Installation consumer could not be completed", true);

/** Reuses the supplied Host. This registry owns consumers and streams, never shared jobs or Host disposal. */
export function createInstallOwnership(host: HostInstallation) {
  const sessions = new Map<object, Session>();
  const known = new WeakMap<object, { original: InstallOwnerAuthority; value: Session }>();
  const admissions = new WeakMap<ObservationAdmission, ObservationAdmission>();

  const captureAdmission = (admission?: ObservationAdmission) => {
    if (!admission) return undefined;
    const previous = admissions.get(admission);

    if (
      previous &&
      (previous.cwd !== admission.cwd || previous.requireCurrent !== admission.requireCurrent)
    )
      throw failure("conflict", "Installation observation authority cannot be rebound");

    if (previous) return previous;
    const snapshot = Object.freeze({ ...admission });
    admissions.set(admission, snapshot);

    return snapshot;
  };

  let disposed = false;
  let consumers = 0;
  let streams = 0;
  let retained = 0;

  function session(original: InstallOwnerAuthority): Session {
    const authority = Object.freeze({ ...original });
    const controller = new AbortController();
    const signal = AbortSignal.any([authority.lifetime, controller.signal]);
    const entries = new Map<string, Entry>();
    const pending = new Set<Promise<unknown>>();
    const results = new Set<Promise<unknown>>();
    let sealed = false;
    let closing: Promise<void> | undefined;

    const assertOwner = () => {
      if (disposed || sealed || signal.aborted || sessions.get(authority.principal) !== value)
        throw failure("not-owner", "Installation belongs to a different or closed connection");
    };

    async function guard(
      action: InstallAction,
      current: AbortSignal,
      admission?: ObservationAdmission
    ) {
      checkAbort(current);
      assertOwner();
      await abortable(authority.requireCurrent(current), current);
      assertOwner();
      await abortable(admission?.requireCurrent(current) ?? Promise.resolve(), current);
      assertOwner();
      await abortable(authority.authorize(action, current), current);
      assertOwner();
      await abortable(authority.requireCurrent(current), current);
      assertOwner();
      await abortable(admission?.requireCurrent(current) ?? Promise.resolve(), current);
      assertOwner();
      checkAbort(current);
    }

    function reserve() {
      assertOwner();

      if (consumers >= 64) throw failure("queue-full", "Installation consumer limit reached", true);

      if (entries.size + pending.size >= 32 || retained + consumers >= 128) {
        const removable = [...entries].find(([, entry]) => entry.settled && !entry.watches.size);

        if (!removable)
          throw failure("queue-full", "Owned installation retention limit reached", true);
        entries.delete(removable[0]);
        retained--;
      }

      if (entries.size + pending.size >= 32 || retained + consumers >= 128)
        throw failure("queue-full", "Owned installation retention limit reached", true);
      consumers++;
    }

    async function validateRequest(request: OwnedInstallRequest, current: AbortSignal) {
      if (request.intent !== "rollback") {
        if (
          request.version !== host.tool(request.toolId).version ||
          request.retainedIdentity !== undefined
        )
          throw failure(
            "conflict",
            "Requested version does not match the pinned installation intent",
            true
          );

        return;
      }

      const versions = await host.versions(request.toolId);
      checkAbort(current);

      if (
        !versions.some(
          (version) =>
            version.identity === request.retainedIdentity && version.version === request.version
        )
      )
        throw failure("not-installed", "Exact rollback version is not retained");
    }

    function attach(
      handle: InstallHandle,
      request: OwnedInstallRequest,
      admission?: ObservationAdmission
    ) {
      let entry = entries.get(handle.jobId);

      if (!entry) {
        const progress = host.progress(request.toolId);
        entry = {
          request,
          admission,
          handles: new Set(),
          watches: new Set(),
          latest: progress?.jobId === handle.jobId ? progress : null,
          error: undefined,
          settled: false,
        };
        entries.set(handle.jobId, entry);
        retained++;
      }

      const record = entry;
      record.settled = false;
      record.error = undefined;
      record.handles.add(handle);

      const result = handle.result
        .then(
          () => {
            record.error = undefined;
          },
          (cause: unknown) => {
            record.error = normalize(cause);
          }
        )
        .finally(() => {
          consumers--;
          record.handles.delete(handle);
          results.delete(result);

          if (record.handles.size) return;
          record.settled = true;

          for (const watch of record.watches) watch.finish(record.error);
        });

      results.add(result);
    }

    async function install(
      request: OwnedInstallRequest,
      admission: ObservationAdmission | undefined,
      input: AbortSignal
    ) {
      const current = AbortSignal.any([input, signal]);
      const action: InstallAction = Object.freeze({ operation: "install", request });
      const requireCurrent: RequestGuard = (next) => guard(action, next, admission);
      let handle: InstallHandle | undefined;
      let attached = false;

      try {
        await requireCurrent(current);
        await validateRequest(request, current);
        await requireCurrent(current);
        handle =
          request.intent === "rollback"
            ? await host.rollback(
                request.toolId,
                rollbackIdentity(request),
                requireCurrent,
                current,
                admission
              )
            : await host.install(
                request.toolId,
                request.intent,
                requireCurrent,
                current,
                admission
              );
        attach(handle, request, admission);
        attached = true;
        await requireCurrent(current);

        return { jobId: handle.jobId };
      } catch (cause) {
        handle?.cancel();
        throw normalize(cause);
      } finally {
        if (!attached) consumers--;
      }
    }

    const find = (jobId: string) => {
      assertOwner();
      const entry = entries.get(jobId);

      if (!entry) throw failure("not-owner", "Installation job is not owned by this connection");

      return entry;
    };

    function seal() {
      if (sealed) return;
      sealed = true;
      controller.abort();

      for (const entry of entries.values()) {
        for (const handle of entry.handles) handle.cancel();

        for (const watch of entry.watches) watch.dispose();
      }
    }

    async function close() {
      seal();
      await Promise.allSettled(pending);
      await Promise.allSettled(results);
      retained -= entries.size;
      entries.clear();
      authority.lifetime.removeEventListener("abort", lifetimeEnded);
      sessions.delete(authority.principal);
    }

    const lifetimeEnded = () => {
      seal();
      void port.dispose();
    };

    const port: InstallOwnerPort = {
      start(input: OwnedInstallRequest, admission?: ObservationAdmission, inputSignal = signal) {
        const request = Object.freeze(Schema.decodeUnknownSync(InstallDemand)(input));
        const captured = captureAdmission(admission);
        reserve();
        const task = install(request, captured, inputSignal).finally(() => pending.delete(task));
        pending.add(task);

        return task;
      },
      async cancel(jobId: string, input = signal) {
        const entry = find(jobId);
        const current = AbortSignal.any([input, signal]);
        await guard(
          { operation: "cancel", request: entry.request, jobId },
          current,
          entry.admission
        );
        find(jobId);

        if (
          entry.settled ||
          (entry.latest && ["completed", "failed", "cancelled"].includes(entry.latest.phase))
        )
          return;

        for (const handle of entry.handles) handle.cancel();

        for (const watch of entry.watches)
          watch.finish(failure("cancelled", "Owned installation consumer cancelled", true));
      },
      async watch(jobId: string, input = signal) {
        const entry = find(jobId);
        const current = AbortSignal.any([input, signal]);

        const action: InstallAction = Object.freeze({
          operation: "watch",
          request: entry.request,
          jobId,
        });

        await guard(action, current, entry.admission);
        find(jobId);

        if (
          streams >= 64 ||
          [...entries.values()].reduce((count, job) => count + job.watches.size, 0) >= 8
        )
          throw failure("queue-full", "Installation progress stream limit reached", true);
        streams++;

        const watch = ownedProgress({
          signal: current,
          guard: (next) => guard(action, next, entry.admission),
          latest: entry.latest,
          settled: entry.settled,
          error: entry.error,
          detach: () => {
            if (entry.watches.delete(watch)) streams--;
          },
        });

        entry.watches.add(watch);

        return { updates: watch.updates, dispose: async () => watch.dispose() };
      },
      stats: () => ({
        retained: entries.size,
        pending: pending.size,
        handles: results.size,
        sealed,
      }),
      dispose() {
        closing ??= close();

        return closing;
      },
    };

    const value: Session = {
      port,
      publish(progress: Progress) {
        const entry = entries.get(progress.jobId);

        if (!entry || sealed || entry.settled) return;

        if (entry.latest && progress.sequence <= entry.latest.sequence) return;
        entry.latest = structuredClone(progress);

        for (const watch of entry.watches) watch.publish(progress);
      },
    };

    authority.lifetime.addEventListener("abort", lifetimeEnded, { once: true });

    return value;
  }

  const unsubscribe = host.subscribe((progress) => {
    for (const owner of sessions.values()) owner.publish(progress);
  });

  return {
    bind(authority: InstallOwnerAuthority) {
      if (
        disposed ||
        authority.lifetime.aborted ||
        authority.authorize === undefined ||
        authority.requireCurrent === undefined
      )
        throw failure("not-owner", "Independent installation authority is unavailable");
      const previous = known.get(authority.principal);

      if (previous) {
        if (previous.original !== authority || previous.value.port.stats().sealed)
          throw failure("not-owner", "Installation connection authority cannot be rebound");

        return previous.value.port;
      }

      if (sessions.size >= 16)
        throw failure("queue-full", "Installation owner limit reached", true);
      const value = session(authority);
      sessions.set(authority.principal, value);
      known.set(authority.principal, { original: authority, value });

      return value.port;
    },
    stats: () => ({ owners: sessions.size, consumers, streams, retained, disposed }),
    async dispose() {
      disposed = true;
      unsubscribe();
      await Promise.all([...sessions.values()].map((owner) => owner.port.dispose()));
    },
  };
}
