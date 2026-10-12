import { useEffect, useMemo } from "react";
import { useApp, useSelection } from "../../../shell/hooks.ts";
import { publishSummary } from "../bridge.ts";
import { pruneDismissed } from "../dismissed.ts";
import { useInboxUntimedView } from "../hooks.ts";
import { toSummary, turnsOf } from "../model/summary.ts";

/** Mounted once in the app: keeps the main process's Needs You summary current. */
export const NeedsYouPublisher = () => {
  const { inbox, current } = useInboxUntimedView();
  const { pane, mode, settings, hostKey, sessionId } = useSelection();
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);
  const constellations = useApp((s) => s.constellations);

  // Whole records, not views: a Lead's digests tell its digest-started Turns apart.
  const views = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(constellations).map(([key, model]) => [key, [...model.byId.values()]])
      ),
    [constellations]
  );

  const turns = useMemo(() => turnsOf({ hosts, models, views }), [hosts, models, views]);

  const summary = useMemo(() => {
    // Settings, Review and Edit cover the session pane: its session isn't on screen.
    const shown = pane === "session" && mode === "orchestrate" && settings === null;
    const focused = shown && hostKey !== null && sessionId !== null ? { hostKey, sessionId } : null;

    return toSummary({ inbox, focused, turns });
  }, [inbox, pane, mode, settings, hostKey, sessionId, turns]);

  useEffect(() => publishSummary(summary), [summary]);
  // Dismissals whose session changed since are dropped, so the item stays back.
  useEffect(() => pruneDismissed(current), [current]);

  return null;
};
