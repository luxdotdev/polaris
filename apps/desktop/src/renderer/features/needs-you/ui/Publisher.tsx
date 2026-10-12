import { useEffect, useMemo } from "react";
import { useApp, useSelection } from "../../../shell/hooks.ts";
import { useAllConstellations } from "../../sessions/source.ts";
import { publishSummary } from "../bridge.ts";
import { useInboxUntimed } from "../hooks.ts";
import { toSummary, turnsOf } from "../model/summary.ts";

/** Mounted once in the app: keeps the main process's Needs You summary current. */
export const NeedsYouPublisher = () => {
  const inbox = useInboxUntimed();
  const { pane, hostKey, sessionId } = useSelection();
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);
  const views = useAllConstellations();
  const turns = useMemo(() => turnsOf({ hosts, models, views }), [hosts, models, views]);

  const summary = useMemo(() => {
    const focused =
      pane === "session" && hostKey !== null && sessionId !== null ? { hostKey, sessionId } : null;

    return toSummary({ inbox, focused, turns });
  }, [inbox, pane, hostKey, sessionId, turns]);

  useEffect(() => publishSummary(summary), [summary]);

  return null;
};
