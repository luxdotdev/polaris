/** The open file's language status, read from the status, Trust and app stores. */
import { useEffect, useMemo } from "react";
import { hostInSentence } from "../../../shell/hostCopy.ts";
import { useApp } from "../../../shell/hooks.ts";
import { polaris } from "../../bridge.ts";
import { fileKey } from "../model/drafts.ts";
import { useTrustStatus } from "../trust/store.ts";
import { useInterpreters } from "../python/store.ts";
import { logKey, useServerLog } from "./log.ts";
import { watchHostTools } from "./feed.ts";
import { statusView, type StatusView } from "./model.ts";
import {
  runtimeKey,
  useFileLanguage,
  useHostTools,
  useRuntimes,
  type ContextRuntime,
} from "./store.ts";

export const useLanguageStatus = (
  hostKey: string,
  workspaceId: string,
  path: string,
  language: string
): StatusView & { readonly file: ReturnType<typeof useFileLanguage> } => {
  const key = fileKey(hostKey, path);
  const file = useFileLanguage(key);
  const runtimes = useRuntimes();
  const trust = useTrustStatus(key);
  const tools = useHostTools(hostKey);
  const python = useInterpreters(key);

  const log = useServerLog(
    file?.checkout == null
      ? ""
      : logKey({
          hostKey,
          checkout: file.checkout,
          providerId: file.providers[0]?.providerId ?? "",
        })
  );

  const host = useApp((s) => s.hosts.find((h) => h.key === hostKey));

  const workspace = useApp(
    (s) => s.hostModels[hostKey]?.workspaces.get(workspaceId)?.name ?? "this workspace"
  );

  return useMemo(() => {
    const ordered: ContextRuntime[] = [];

    for (const provider of file?.providers ?? []) {
      const contextId = file?.contexts[provider.providerId];

      const runtime =
        contextId === undefined ? undefined : runtimes[runtimeKey(hostKey, contextId)];

      if (runtime !== undefined) ordered.push(runtime);
    }

    const view = statusView({
      language,
      file,
      runtimes: ordered,
      trust,
      tools,
      host: host?.label ?? "this Host",
      hostInSentence: hostInSentence(host),
      workspace,
      now: Date.now(),
      python,
      lastLogLine: log?.lines.at(-1)?.text ?? null,
    });

    return { ...view, file };
  }, [file, runtimes, trust, tools, host, workspace, language, hostKey, python, log]);
};

/** Install facts for the Host while something needs them; the watch ends with the need. */
export const useHostToolsWatch = (hostKey: string, language: string, active: boolean) =>
  useEffect(() => {
    const api = polaris().languages;

    if (!active || api === undefined) return;

    return watchHostTools(api, hostKey, language);
  }, [hostKey, language, active]);
