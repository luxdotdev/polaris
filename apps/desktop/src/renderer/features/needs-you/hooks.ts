import { useMemo, useSyncExternalStore } from "react";
import { useApp } from "../../shell/hooks.ts";
import { useNow } from "../../shell/useNow.ts";
import { answeredHere } from "./answered.ts";
import { buildInbox, type Inbox } from "./model/inbox.ts";

const useInboxAt = (now: number): Inbox => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);
  const answered = useSyncExternalStore(answeredHere.subscribe, answeredHere.get);

  return useMemo(
    () => buildInbox({ hosts, models, now, answeredHere: answered }),
    [hosts, models, now, answered]
  );
};

/** The inbox as shown: ages refresh every 30s and answers from elsewhere fade after a minute. */
export const useInbox = (): Inbox => useInboxAt(useNow(30_000));

/**
 * The inbox without a clock, for the always-mounted publisher: its summary has no ages, so
 * an idle app doesn't wake for it.
 */
export const useInboxUntimed = (): Inbox => useInboxAt(0);
