/** The inbox as the main process needs it: the count, who is waiting on what, and who is working. */
import { harnessHue } from "@polaris/ui";
import type { HostView } from "../../../../shared/api.ts";
import type {
  NeedsYouSession,
  NeedsYouSummary,
  NeedsYouTurn,
} from "../../../../shared/needsYou.ts";
import type { HostModel } from "../../../store/hostModel.ts";
import { digestStarted, type Digest } from "../../constellation/model/index.ts";
import type { ConstellationView } from "../../sessions/source.ts";
import type { Inbox } from "./inbox.ts";

export interface SummaryInput {
  readonly inbox: Inbox;
  /** The session the window shows, if any. */
  readonly focused: { readonly hostKey: string; readonly sessionId: string } | null;
  /** Working and Idle sessions (`turnsOf`); none when left out. */
  readonly turns?: ReadonlyArray<NeedsYouTurn>;
}

/** A graph as its own stream delivered it; `digests` names the Lead Turns Polaris started. */
export interface TurnsView extends ConstellationView {
  readonly digests?: ReadonlyArray<Digest>;
}

export interface TurnsInput {
  readonly hosts: ReadonlyArray<HostView>;
  readonly models: Readonly<Record<string, HostModel>>;
  readonly views: Readonly<Record<string, ReadonlyArray<TurnsView>>>;
}

/** Constellation workers' sessions: their Lead reports on them, so their Turns aren't news. */
const workerSessions = (views: TurnsInput["views"]) =>
  new Set(
    Object.values(views).flatMap((list) =>
      list.flatMap(({ constellation }) =>
        constellation.attempts
          .map((a) => a.sessionId)
          .filter((id) => id !== constellation.leadSessionId)
      )
    )
  );

/** Each Lead session's digests, by Host and session. */
const leadDigests = (views: TurnsInput["views"]) =>
  new Map(
    Object.entries(views).flatMap(([hostKey, list]) =>
      list.map(
        ({ constellation, digests }) =>
          [`${hostKey}\u0000${constellation.leadSessionId}`, digests ?? []] as const
      )
    )
  );

/** Every Working or Idle session outside a Constellation's workers, for Turn-ended notifications. */
export const turnsOf = ({ hosts, models, views }: TurnsInput): Array<NeedsYouTurn> => {
  const workers = workerSessions(views);
  const digests = leadDigests(views);

  return hosts.flatMap((host) =>
    [...(models[host.key]?.sessions.values() ?? [])].flatMap((entry): Array<NeedsYouTurn> => {
      const { id, state, title, harness } = entry.session;

      if ((state !== "working" && state !== "idle") || workers.has(id)) return [];
      const lead = digests.get(`${host.key}\u0000${id}`);
      const turnId = entry.lastTurnId ?? null;

      return [
        {
          hostKey: host.key,
          hostLabel: host.label,
          sessionId: id,
          title,
          harness: harnessHue(harness).name,
          state,
          prompt: entry.lastTurnPreview,
          digestStarted: lead !== undefined && turnId !== null && digestStarted(lead, turnId),
        },
      ];
    })
  );
};

export const toSummary = ({ inbox, focused, turns = [] }: SummaryInput): NeedsYouSummary => {
  const waiting = inbox.waiting.map((w): NeedsYouSession => ({
    hostKey: w.hostKey,
    hostLabel: w.hostLabel,
    workspace: w.workspace,
    sessionId: w.entry.session.id,
    title: w.entry.session.title,
    harness: harnessHue(w.entry.session.harness).name,
    requests: w.requests.map((r) => ({
      requestId: r.id,
      kind: r.kind,
      title: r.title,
      detail: r.detail,
      options: r.options,
    })),
  }));

  const interrupted = inbox.also
    .filter((a) => a.kind === "interrupted")
    .map((a): NeedsYouSession => ({
      hostKey: a.hostKey,
      hostLabel: a.hostLabel,
      workspace: a.workspace,
      sessionId: a.entry.session.id,
      title: a.entry.session.title,
      harness: harnessHue(a.entry.session.harness).name,
      requests: [],
    }));

  return { count: inbox.count, sessions: [...waiting, ...interrupted], focused, turns };
};
