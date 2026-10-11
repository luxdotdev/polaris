/**
 * What the Daemon said about the open files' Language Integrations, for the status pill
 * (DESIGN.md, Editor: Language status): discovery, each context's runtime and install progress.
 */
import type * as P from "@polaris/protocol";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { formatRoute } from "../formatting/project.ts";

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
  /** The project's own formatter, and whether the checkout was trusted when it was found. */
  readonly formatter?: ProjectFormatting | null;
}

export interface ProjectFormatting {
  readonly tool: P.LanguageProjectFormatterTool;
  readonly ignored: boolean;
  readonly trusted: boolean;
}

export interface ContextRuntime {
  readonly context: P.LanguageContextIdentity;
  readonly runtime: Runtime;
  readonly since: number;
}

export interface HostTools {
  /** The Host's installation state per tool (`languages.host.state`). */
  readonly tools: Readonly<Record<string, P.LanguageHostToolState>>;
  readonly platform: P.LanguageHostState["platform"] | null;
  /** Each catalog tool's pinned version, until the Host state arrives. */
  readonly pinned?: Readonly<Record<string, string>>;
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
  patchFile(key, {
    phase: "discovered",
    checkout: found.checkout,
    providers: found.providers,
    formatter:
      formatRoute(found.effectiveSettings.formatter, found.projectFormatter) === "server" ||
      found.projectFormatter === undefined ||
      found.projectFormatter === null
        ? null
        : {
            tool: found.projectFormatter.tool,
            ignored: found.projectFormatter.ignored,
            trusted: found.trust.trusted,
          },
  });

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
  state.hosts[hostKey] ?? { tools: {}, platform: null };

export const hostStateArrived = (hostKey: string, host: P.LanguageHostState) =>
  statusStore.setState((state) => ({
    hosts: {
      ...state.hosts,
      [hostKey]: {
        ...hostTools(state, hostKey),
        platform: host.platform,
        tools: Object.fromEntries(host.tools.map((tool) => [tool.toolId, tool])),
      },
    },
  }));

export const catalogArrived = (hostKey: string, catalog: P.LanguageCatalog) =>
  statusStore.setState((state) => ({
    hosts: {
      ...state.hosts,
      [hostKey]: {
        ...hostTools(state, hostKey),
        pinned: Object.fromEntries(catalog.tools.map((tool) => [tool.id, tool.version])),
      },
    },
  }));

export const useFileLanguage = (key: string) =>
  useStore(statusStore, (state) => state.files[key] ?? null);

export const useHostTools = (hostKey: string) =>
  useStore(statusStore, (state) => state.hosts[hostKey] ?? null);

export const useRuntimes = () => useStore(statusStore, (state) => state.runtimes);
