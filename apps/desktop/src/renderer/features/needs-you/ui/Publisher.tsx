import { useEffect, useMemo } from "react";
import { useSelection } from "../../../shell/hooks.ts";
import { publishSummary } from "../bridge.ts";
import { useInboxUntimed } from "../hooks.ts";
import { toSummary } from "../model/summary.ts";

/** Mounted once in the app: keeps the main process's Needs You summary current. */
export const NeedsYouPublisher = () => {
  const inbox = useInboxUntimed();
  const { pane, hostKey, sessionId } = useSelection();

  const summary = useMemo(() => {
    const focused =
      pane === "session" && hostKey !== null && sessionId !== null ? { hostKey, sessionId } : null;

    return toSummary({ inbox, focused });
  }, [inbox, pane, hostKey, sessionId]);

  useEffect(() => publishSummary(summary), [summary]);

  return null;
};
