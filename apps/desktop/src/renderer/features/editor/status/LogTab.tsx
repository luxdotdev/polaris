/** A log tab's strip entry and body, for the editor pane (Paper L6). */
import { useApp } from "../../../shell/hooks.ts";
import type { TabView } from "../runtime/hooks.ts";
import { useTrustStatus } from "../trust/store.ts";
import { LogView } from "./LogView.tsx";
import type { LogTab } from "./logTabs.ts";
import {
  runtimeKey,
  statusStore,
  useHostTools,
  useRuntimes,
  type ContextRuntime,
} from "./store.ts";
import { watchServerLog } from "./feed.ts";
import { polaris } from "../../bridge.ts";
import * as P from "@polaris/protocol";
import { useEffect } from "react";
import { useHostToolsWatch } from "./hooks.ts";
import { fileKey } from "../model/drafts.ts";
import { useStore } from "zustand";
import { Predicate, Schema } from "effect";

export const useLogTabViews = (tabs: readonly LogTab[]): TabView[] => {
  const hosts = useApp((s) => s.hosts);

  return tabs.map((tab) => ({
    id: tab.id,
    view: "log",
    path: `${tab.language} log`,
    label: `${tab.language} log`,
    detail: hosts.find((host) => host.key === tab.scope.hostKey)?.label,
    preview: false,
    dirty: false,
    agent: null,
  }));
};

const ago = (since: number, now: number) => {
  const minutes = Math.floor((now - since) / 60_000);

  return minutes < 1
    ? "just now"
    : minutes < 60
      ? `${minutes}m ago`
      : `${Math.floor(minutes / 60)}h ago`;
};

/** A file of this checkout, so the tab can name the TypeScript the Daemon selected for it. */
const useScopeFile = (tab: LogTab) =>
  useStore(statusStore, (state) => {
    for (const [key, file] of Object.entries(state.files))
      if (
        file.hostKey === tab.scope.hostKey &&
        JSON.stringify(file.checkout) === JSON.stringify(tab.scope.checkout) &&
        file.contexts[tab.scope.providerId] !== undefined
      )
        return `${key}\u0001${file.contexts[tab.scope.providerId] ?? ""}`;

    return null;
  });

/** Follows the server's live log while it runs; a restart's new generation subscribes again. */
const useLiveLog = (hostKey: string, runtime: ContextRuntime | undefined) => {
  const live =
    runtime !== undefined && Predicate.isTagged(runtime.runtime, "Ready")
      ? JSON.stringify(runtime.context)
      : null;

  useEffect(() => {
    const api = polaris().languages;

    if (live === null || api === undefined) return;

    return watchServerLog(
      api,
      hostKey,
      Schema.decodeUnknownSync(Schema.fromJsonString(P.LanguageContextIdentity))(live)
    );
  }, [hostKey, live]);
};

export const LogTabBody = ({ tab }: { readonly tab: LogTab }) => {
  const { hostKey, providerId } = tab.scope;
  useHostToolsWatch(hostKey, true);
  const tools = useHostTools(hostKey);
  const runtimes = useRuntimes();
  const found = useScopeFile(tab);
  const [key = "", contextId = ""] = found?.split("\u0001") ?? [];
  const file = found === null ? null : { key, contextId };
  const trust = useTrustStatus(file?.key ?? fileKey(hostKey, ""));
  const runtime = file === null ? undefined : runtimes[runtimeKey(hostKey, file.contextId)];
  useLiveLog(hostKey, runtime);
  const fact = tools?.availability[providerId];
  const version = fact === undefined ? null : fact.pinnedVersion;
  const typescript = tools?.availability.typescript?.pinnedVersion ?? null;

  const typescriptDetail =
    providerId !== "typescript-language-server" || trust === null
      ? null
      : trust.provider === "project" && trust.wouldRun.typescriptVersion !== null
        ? `project TypeScript ${trust.wouldRun.typescriptVersion}`
        : `bundled TypeScript${typescript === null ? "" : ` ${typescript}`}`;

  const detail = [
    typescriptDetail,
    runtime === undefined
      ? null
      : `${Predicate.isTagged(runtime.runtime, "Ready") ? "started" : runtime.runtime._tag.toLowerCase()} ${ago(runtime.since, Date.now())}`,
  ].filter((part) => part !== null);

  return (
    <LogView
      key={tab.id}
      scope={tab.scope}
      server={version === null ? providerId : `${providerId} ${version}`}
      detail={detail.length === 0 ? null : detail.join(" · ")}
    />
  );
};
