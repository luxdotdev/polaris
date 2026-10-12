import { useMemo, useSyncExternalStore } from "react";
import { useApp } from "../../shell/hooks.ts";
import { useNow } from "../../shell/useNow.ts";
import { useAllConstellations } from "../sessions/source.ts";
import { answeredHere } from "./answered.ts";
import { dismissed } from "./dismissed.ts";
import { applyDismissed, type DismissedInbox, type Dismissible } from "./model/dismissed.ts";
import {
  buildConstellationInbox,
  type ConstellationInbox,
  withConstellations,
} from "./model/constellation.ts";
import { buildInbox, type Inbox } from "./model/inbox.ts";
import { dismiss } from "./dismissed.ts";

/** Constellation items grouped under their Leads (Paper C5). */
export const useConstellationInbox = (): ConstellationInbox => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);
  const views = useAllConstellations();

  return useMemo(() => buildConstellationInbox({ hosts, models, views }), [hosts, models, views]);
};

const useInboxAt = (now: number): DismissedInbox<Inbox> => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);
  const answered = useSyncExternalStore(answeredHere.subscribe, answeredHere.get);
  const hidden = useSyncExternalStore(dismissed.subscribe, dismissed.get);
  const constellations = useConstellationInbox();

  return useMemo(
    () =>
      applyDismissed(
        withConstellations(
          buildInbox({ hosts, models, now, answeredHere: answered }),
          constellations
        ),
        hidden
      ),
    [hosts, models, now, answered, hidden, constellations]
  );
};

/** The inbox as shown, with what this Mac dismissed: ages refresh every 30s. */
export const useInboxView = (): DismissedInbox<Inbox> => useInboxAt(useNow(30_000));

/** The inbox as shown: ages refresh every 30s and answers from elsewhere fade after a minute. */
export const useInbox = (): Inbox => useInboxView().inbox;

/**
 * The inbox without a clock, for the always-mounted publisher: its summary has no ages, so
 * an idle app doesn't wake for it.
 */
export const useInboxUntimedView = (): DismissedInbox<Inbox> => useInboxAt(0);

export const useInboxUntimed = (): Inbox => useInboxUntimedView().inbox;

/** Sessions dismissed from Needs You on this Mac that still need you (`inboxKey`). */
export const useQuietSessions = (): ReadonlySet<string> => useInboxUntimedView().quiet;

/** What needs you on every Host, Constellation items included: the Orchestrate and sidebar badges. */
export const useNeedsYouCount = (): number => useInboxUntimed().count;

/** The inbox without the sessions shown under their Lead (Constellation items). */
export const withoutConstellations = (inbox: Inbox, constellations: ConstellationInbox): Inbox => ({
  ...inbox,
  waiting: inbox.waiting.filter((w) => !constellations.sessions.has(w.key)),
  also: inbox.also.filter((a) => !constellations.sessions.has(a.key)),
});

/** What "Dismiss all" hides: every session card in the inbox (Paper 10, in the sidebar header). */
export const useDismissAll = (): {
  readonly items: ReadonlyArray<Dismissible>;
  readonly dismissAll: () => void;
} => {
  const { inbox } = useInboxUntimedView();
  const constellations = useConstellationInbox();

  return useMemo(() => {
    const shown = withoutConstellations(inbox, constellations);
    const items = [...shown.waiting, ...shown.also];

    return { items, dismissAll: () => dismiss(items) };
  }, [inbox, constellations]);
};
