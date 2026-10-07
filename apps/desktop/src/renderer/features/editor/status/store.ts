/**
 * What the Daemon said about the open files' Language Integrations, for the status pill
 * (DESIGN.md, Editor: Language status): discovery, each context's runtime and install progress.
 */
import type * as P from "@polaris/protocol";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type Runtime = typeof P.LanguageRuntime.Type;

export type Discovered = (typeof P.LanguageDiscovery.Type)["providers"][number];

export type DiscoveryFailure = {
  readonly reason: P.LanguageError["reason"] | "unknown";
  readonly message: string;
};

export interface FileLanguage {
  readonly hostKey: string;
  readonly path: string;
  readonly checkout: P.LanguageCheckout | null;
  /** "local" when the Host has no language tooling, so only syntax runs. */
  readonly phase: "local" | "checking" | "discovered" | "failed";
  readonly failure: DiscoveryFailure | null;
  readonly providers: readonly Discovered[];
  /** The contexts this file's providers acquired, by provider id. */
  readonly contexts: Readonly<Record<string, string>>;
}

export interface ContextRuntime {
  readonly context: P.LanguageContextIdentity;
  readonly runtime: Runtime;
  readonly since: number;
}

export interface HostTools {
  readonly availability: Readonly<Record<string, P.LanguageAvailability>>;
  readonly progress: Readonly<Record<string, P.LanguageInstallProgress>>;
}

interface StatusState {
  readonly files: Readonly<Record<string, FileLanguage>>;
  /** Runtime by Host and context id; a Replaced context keeps its id at a higher generation. */
  readonly runtimes: Readonly<Record<string, ContextRuntime>>;
  readonly hosts: Readonly<Record<string, HostTools>>;
}

export const statusStore = createStore<StatusState>(() => ({ files: {}, runtimes: {}, hosts: {} }));

export const runtimeKey = (hostKey: string, contextId: string) =>
  JSON.stringify([hostKey, contextId]);

const patchFile = (key: string, patch: Partial<FileLanguage>) =>
  statusStore.setState((state) => {
    const current = state.files[key];

    return current === undefined
      ? state
      : { files: { ...state.files, [key]: { ...current, ...patch } } };
  });

export const statusOpened = (key: string, hostKey: string, path: string) =>
  statusStore.setState((state) => ({
    files: {
      ...state.files,
      [key]: {
        hostKey,
        path,
        checkout: null,
        phase: "local",
        failure: null,
        providers: [],
        contexts: {},
      },
    },
  }));

export const statusClosed = (key: string) =>
  statusStore.setState((state) => {
    const { [key]: _gone, ...files } = state.files;

    return { files };
  });

export const statusLocal = (key: string) =>
  patchFile(key, { phase: "local", failure: null, providers: [], contexts: {} });

export const statusChecking = (key: string, checkout: P.LanguageCheckout) =>
  patchFile(key, { phase: "checking", checkout, failure: null, contexts: {} });

export const statusDiscovered = (key: string, found: typeof P.LanguageDiscovery.Type) =>
  patchFile(key, { phase: "discovered", checkout: found.checkout, providers: found.providers });

export const statusFailed = (key: string, failure: DiscoveryFailure) =>
  patchFile(key, { phase: "failed", failure });

export const statusAttached = (key: string, providerId: string, contextId: string) =>
  statusStore.setState((state) => {
    const current = state.files[key];

    return current === undefined || current.contexts[providerId] === contextId
      ? state
      : {
          files: {
            ...state.files,
            [key]: { ...current, contexts: { ...current.contexts, [providerId]: contextId } },
          },
        };
  });

/** A context's runtime from its acquire snapshot or its watch; older generations never win. */
export const runtimeArrived = (
  hostKey: string,
  context: P.LanguageContextIdentity,
  runtime: Runtime,
  now = Date.now()
) =>
  statusStore.setState((state) => {
    const key = runtimeKey(hostKey, context.contextId);
    const known = state.runtimes[key];

    if (known !== undefined && known.context.generation > context.generation) return state;
    const since = known?.runtime._tag === runtime._tag ? known.since : now;

    return { runtimes: { ...state.runtimes, [key]: { context, runtime, since } } };
  });

const hostTools = (state: StatusState, hostKey: string): HostTools =>
  state.hosts[hostKey] ?? { availability: {}, progress: {} };

export const availabilityArrived = (hostKey: string, facts: readonly P.LanguageAvailability[]) =>
  statusStore.setState((state) => {
    const tools = hostTools(state, hostKey);
    const availability = { ...tools.availability };

    for (const fact of facts) {
      const known = availability[fact.toolId];

      if (known === undefined || known.checkedAt <= fact.checkedAt)
        availability[fact.toolId] = fact;
    }

    return { hosts: { ...state.hosts, [hostKey]: { ...tools, availability } } };
  });

export const progressArrived = (hostKey: string, progress: P.LanguageInstallProgress) =>
  statusStore.setState((state) => {
    const tools = hostTools(state, hostKey);
    const known = tools.progress[progress.toolId];

    if (
      known !== undefined &&
      known.jobId === progress.jobId &&
      known.sequence >= progress.sequence
    )
      return state;

    return {
      hosts: {
        ...state.hosts,
        [hostKey]: { ...tools, progress: { ...tools.progress, [progress.toolId]: progress } },
      },
    };
  });

export const useFileLanguage = (key: string) =>
  useStore(statusStore, (state) => state.files[key] ?? null);

export const useHostTools = (hostKey: string) =>
  useStore(statusStore, (state) => state.hosts[hostKey] ?? null);

export const useRuntimes = () => useStore(statusStore, (state) => state.runtimes);
