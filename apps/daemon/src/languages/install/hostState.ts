import {
  LanguageHostState,
  LanguageHostToolStatus,
  type LanguageHostToolState,
  type LanguageHostPrerequisite,
  type LanguageInstallProgress,
  type HostId,
  type LanguagePlatform,
} from "@polaris/protocol";
import type { Tool } from "../catalog/model.ts";
import type { Installer } from "./index.ts";
import { createHostPrerequisiteProbe } from "./hostStateProbes.ts";
import type { HostPresence } from "./hostStateProbes.ts";
import { abortable, checkAbort, failure } from "./validation.ts";
import { preflightDeadlineMs } from "./preflightDeadline.ts";

export interface HostStateInput {
  toolIds: readonly string[];
  refresh: boolean;
}

export function hostToolStatus(progress: LanguageInstallProgress | null, version: string | null) {
  if (progress === null)
    return version === null
      ? LanguageHostToolStatus.cases.NotDownloaded.make({})
      : LanguageHostToolStatus.cases.Installed.make({ version });

  switch (progress.phase) {
    case "completed":
      return LanguageHostToolStatus.cases.Installed.make({
        version: progress.activeVersion ?? progress.version,
      });
    case "cancelled":
    case "failed":
      return LanguageHostToolStatus.cases.Failed.make({
        reason: progress.message || "Language tool download was cancelled",
        retainedVersion: progress.activeVersion,
      });
    default:
      return LanguageHostToolStatus.cases.Downloading.make({ progress });
  }
}

/** Read-only projection of the sole Host installer; feeds retain one replaceable snapshot. */
export function createHostToolStates(options: {
  timeoutMs?: number;
  hostId: HostId;
  platform: typeof LanguagePlatform.Type;
  tools: readonly Tool[];
  installer: Pick<Installer, "current" | "progress" | "subscribe" | "recoveryFacts">;
  lifetime: AbortSignal;
  probes?: ReturnType<typeof createHostPrerequisiteProbe>;
}) {
  const tools = new Map(options.tools.map((tool) => [tool.id, tool]));
  const rows = new Map<string, LanguageHostToolState>();
  const listeners = new Set<() => void>();
  const probes = options.probes ?? createHostPrerequisiteProbe();
  let readers = 0;
  let stop: (() => void) | undefined;

  const idsFor = (input: HostStateInput) => {
    const ids = input.toolIds.length ? [...new Set(input.toolIds)] : [...tools.keys()];

    if (ids.length > 256 || ids.some((id) => !tools.has(id)))
      throw failure("invalid-input", "Unknown or excessive Host tools");

    return ids;
  };

  const snapshot = (ids: readonly string[]) =>
    LanguageHostState.make({
      hostId: options.hostId,
      platform: options.platform,
      tools: ids.flatMap((id) => {
        const row = rows.get(id);

        return row === undefined ? [] : [structuredClone(row)];
      }),
    });

  const publish = () => {
    for (const listener of listeners) listener();
  };

  const nodeFacts = (observed: HostPresence) => {
    for (const [id, value] of rows) {
      rows.set(id, {
        ...value,
        prerequisites: value.prerequisites.map((fact) =>
          fact.requirement.id === "node" ? { ...fact, ...observed } : fact
        ),
      });
    }
  };

  const progress = (update: LanguageInstallProgress) => {
    const row = rows.get(update.toolId);

    if (row !== undefined) rows.set(update.toolId, { ...row, state: hostToolStatus(update, null) });

    if (update.toolId === "node" && update.activeVersion !== null)
      nodeFacts({ presence: "present", version: update.activeVersion, path: null });

    publish();
  };

  const installedState = async (
    id: string,
    signal: AbortSignal,
    current: typeof options.installer.current
  ) => {
    let version: string | null = null;

    try {
      version = (await abortable(current(id), signal))?.version ?? null;
      const debris = await abortable(options.installer.recoveryFacts(id), signal);

      if (debris.length)
        return LanguageHostToolStatus.cases.Failed.make({
          reason: "Language tool installation requires recovery",
          retainedVersion: version,
        });

      return hostToolStatus(options.installer.progress(id), version);
    } catch {
      checkAbort(signal);

      return LanguageHostToolStatus.cases.Failed.make({
        reason: "Private language tool installation could not be verified",
        retainedVersion: version,
      });
    }
  };

  const read = async (input: HostStateInput, incoming: AbortSignal) => {
    const ids = idsFor(input);
    checkAbort(options.lifetime);
    checkAbort(incoming);

    if (readers >= 4) throw failure("queue-full", "Host state read limit reached", true);
    readers++;
    const controller = new AbortController();
    const signal = AbortSignal.any([incoming, options.lifetime, controller.signal]);

    const timer = setTimeout(
      () => controller.abort(failure("timeout", "Host state read timed out", true)),
      options.timeoutMs ?? preflightDeadlineMs
    );

    const batch = probes();
    const versions = new Map<string, ReturnType<typeof options.installer.current>>();

    const current = (id: string) => {
      let pending = versions.get(id);

      if (pending === undefined) {
        pending = options.installer.current(id);
        versions.set(id, pending);
      }

      return pending;
    };

    let node: Promise<HostPresence> | undefined;

    const privateNode = async (): Promise<HostPresence> => {
      try {
        const installed = await abortable(current("node"), signal);
        const update = options.installer.progress("node");
        const version = update?.activeVersion ?? installed?.version ?? null;

        return { presence: version === null ? "missing" : "present", path: null, version };
      } catch {
        checkAbort(signal);

        return { presence: "unknown", path: null, version: null };
      }
    };

    const prerequisites = async (tool: Tool, cached?: readonly LanguageHostPrerequisite[]) => {
      const facts: LanguageHostPrerequisite[] = [];

      for (const requirement of tool.requirements) {
        checkAbort(signal);
        const retained = cached?.find((fact) => fact.requirement.id === requirement.id);

        if (requirement.id !== "node" && retained !== undefined) {
          facts.push(retained);
          continue;
        }

        const observed =
          requirement.id === "node"
            ? await abortable((node ??= privateNode()), signal)
            : await abortable(batch.probe(requirement, signal), signal);

        facts.push({ requirement, ...observed });
      }

      return facts;
    };

    const readRow = async (id: string) => {
      const tool = tools.get(id);

      if (tool === undefined) throw failure("invalid-input", "Unknown Host tool");
      const previous = rows.get(id);

      const [facts, state] = await Promise.allSettled([
        prerequisites(tool, input.refresh ? undefined : previous?.prerequisites),
        installedState(id, signal, current),
      ]);

      if (facts.status === "rejected") throw facts.reason;

      if (state.status === "rejected") throw state.reason;

      checkAbort(signal);
      rows.set(id, {
        toolId: id,
        pinnedVersion: tool.version,
        state: state.value,
        prerequisites: facts.value,
        checkedAt: Date.now(),
      });
    };

    try {
      for (let offset = 0; offset < ids.length; offset += 4) {
        const results = await Promise.allSettled(ids.slice(offset, offset + 4).map(readRow));

        for (const result of results) if (result.status === "rejected") throw result.reason;
      }

      if (node !== undefined) {
        const observed = await node;
        const latest = options.installer.progress("node");

        nodeFacts(
          latest?.activeVersion == null
            ? observed
            : { presence: "present", version: latest.activeVersion, path: null }
        );
      }

      checkAbort(signal);
      publish();

      return snapshot(ids);
    } finally {
      clearTimeout(timer);
      readers--;
    }
  };

  async function watch(
    input: HostStateInput,
    incoming: AbortSignal
  ): Promise<AsyncIterableIterator<LanguageHostState>> {
    const ids = idsFor(input);

    if (listeners.size >= 16)
      throw failure("queue-full", "Host state subscriber limit reached", true);
    const controller = new AbortController();
    const signal = AbortSignal.any([incoming, options.lifetime, controller.signal]);
    let pending: LanguageHostState | undefined;
    let wake: (() => void) | undefined;
    let ready = false;
    let ended = false;

    const changed = () => {
      if (!ready || ended) return;
      pending = snapshot(ids);
      wake?.();
    };

    const finish = () => {
      ended = true;
      pending = undefined;
      listeners.delete(changed);
      signal.removeEventListener("abort", finish);
      controller.abort();

      if (!listeners.size) {
        stop?.();
        stop = undefined;
      }

      wake?.();
    };

    listeners.add(changed);

    signal.addEventListener("abort", finish, { once: true });

    try {
      if (stop === undefined) stop = options.installer.subscribe(progress);
      await read(input, signal);
      checkAbort(signal);
      ready = true;
      changed();
    } catch (cause) {
      finish();
      throw cause;
    }

    const iterator: AsyncIterableIterator<LanguageHostState> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        while (!ended && pending === undefined)
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        wake = undefined;
        const value = pending;
        pending = undefined;

        return value === undefined ? { done: true, value: undefined } : { done: false, value };
      },
      async return() {
        finish();

        return { done: true, value: undefined };
      },
    };

    return iterator;
  }

  return { read, watch, stats: () => ({ readers, subscribers: listeners.size, rows: rows.size }) };
}
