/**
 * Folds the Host stream into this Host's Live Activity slice (docs/adr/0088): how many of the
 * user's agent sessions are working and since when, the newest tool step, and the oldest open
 * approval or question. Reviewer and walkthrough sessions are the Daemon's own and don't count. Pure.
 */
import type {
  AgentSession,
  ApprovalRequest,
  DomainEvent,
  HostStreamItem,
  TurnItem,
} from "@polaris/protocol";
import type { HostSlice, LiveLine, LiveNeed } from "@polaris/protocol/relay";
import { Match } from "effect";

interface Tracked {
  readonly title: string;
  /** Unix seconds its working Turn started; null while it isn't working. */
  readonly since: number | null;
}

/** A step or need before the session's title is filled in at render. */
type Line = Omit<LiveLine, "session">;

type Need = Omit<LiveNeed, "session">;

export interface SliceState {
  readonly synchronized: boolean;
  readonly sessions: ReadonlyMap<string, Tracked>;
  readonly step: Line | null;
  readonly needs: ReadonlyMap<string, Need>;
}

export const emptySlice: SliceState = {
  synchronized: false,
  sessions: new Map(),
  step: null,
  needs: new Map(),
};

const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

const isUsers = (session: AgentSession) => session.origin === null || session.origin === undefined;

const tracked = (session: AgentSession): Tracked => ({
  title: session.title,
  since:
    session.state === "working"
      ? seconds(session.currentUserTurn?.startedAt ?? session.updatedAt)
      : null,
});

const needOf = (request: ApprovalRequest): Need => ({
  at: seconds(request.openedAt),
  sessionId: request.sessionId,
  line: request.title,
  requestId: request.id,
  kind: request.kind === "question" ? "question" : "approval",
});

/** A tool step's one line, or null for items that aren't tool steps. */
export const stepLine = (item: TurnItem): string | null =>
  Match.value(item).pipe(
    Match.tags({
      CommandExecution: ({ command }) => command,
      FileChange: ({ changes }) =>
        changes.length === 1 ? `Edit ${changes[0]?.path ?? ""}` : `Edit ${changes.length} files`,
      ToolCall: ({ title, name }) => title ?? name,
    }),
    Match.orElse(() => null)
  );

const withSession = (state: SliceState, sessionId: string, change: (s: Tracked) => Tracked) => {
  const session = state.sessions.get(sessionId);

  if (session === undefined) return state;
  const sessions = new Map(state.sessions);
  sessions.set(sessionId, change(session));

  return { ...state, sessions };
};

const withNeeds = (state: SliceState, change: (needs: Map<string, Need>) => void): SliceState => {
  const needs = new Map(state.needs);
  change(needs);

  return { ...state, needs };
};

const applyEvent = (state: SliceState, event: DomainEvent, occurredAt: string): SliceState =>
  Match.value(event).pipe(
    Match.tags({
      SessionCreated: ({ session }) => {
        if (!isUsers(session)) return state;
        const sessions = new Map(state.sessions);
        sessions.set(session.id, tracked(session));

        return { ...state, sessions };
      },
      SessionRenamed: ({ sessionId, title }) =>
        withSession(state, sessionId, (s) => ({ ...s, title })),
      TurnStarted: ({ turn }) =>
        withSession(state, turn.sessionId, (s) => ({ ...s, since: seconds(turn.startedAt) })),
      TurnEnded: ({ turn }) => withSession(state, turn.sessionId, (s) => ({ ...s, since: null })),
      SessionStateChanged: ({ sessionId, state: next }) =>
        withSession(state, sessionId, (s) => ({
          ...s,
          since: next === "working" ? (s.since ?? seconds(occurredAt)) : null,
        })),
      TurnItemCompleted: ({ sessionId, item }) => {
        const line = stepLine(item);

        return line === null || !state.sessions.has(sessionId)
          ? state
          : { ...state, step: { at: seconds(occurredAt), sessionId, line } };
      },
      ApprovalRequested: ({ request }) =>
        state.sessions.has(request.sessionId)
          ? withNeeds(state, (needs) => needs.set(request.id, needOf(request)))
          : state,
      ApprovalResolved: ({ requestId }) => withNeeds(state, (needs) => needs.delete(requestId)),
      ApprovalWithdrawn: ({ requestId }) => withNeeds(state, (needs) => needs.delete(requestId)),
    }),
    Match.orElse(() => state)
  );

export const sliceItem = (state: SliceState, item: HostStreamItem): SliceState =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      Snapshot: (snapshot): SliceState => {
        const users = snapshot.sessions.filter((summary) => isUsers(summary.session));

        return {
          synchronized: false,
          sessions: new Map(users.map((s) => [s.session.id, tracked(s.session)])),
          step: null,
          needs: new Map(
            users.flatMap((s) => s.pendingApprovals).map((r) => [r.id, needOf(r)] as const)
          ),
        };
      },
      Synchronized: (): SliceState => ({ ...state, synchronized: true }),
      Event: ({ envelope }) => applyEvent(state, envelope.event, envelope.occurredAt),
    })
  );

/** The slice without `seq`, which the notifier sets as it sends. */
export type SliceContent = Omit<HostSlice, "seq">;

export const renderSlice = (
  state: SliceState,
  host: { readonly hostId: string; readonly hostName: string }
): SliceContent => {
  const title = (sessionId: string) => state.sessions.get(sessionId)?.title ?? "";
  const starts = [...state.sessions.values()].flatMap((s) => (s.since === null ? [] : [s.since]));
  const oldest = [...state.needs.values()].sort((a, b) => a.at - b.at)[0];

  return {
    v: 1,
    hostId: host.hostId,
    host: host.hostName,
    working: starts.length,
    since: starts.length === 0 ? null : Math.min(...starts),
    step: state.step === null ? null : { ...state.step, session: title(state.step.sessionId) },
    need: oldest === undefined ? null : { ...oldest, session: title(oldest.sessionId) },
    needs: state.needs.size,
  };
};

/** Whether `state` has a request `sent` didn't: a Needs You goes out at once, with an alert. */
export const opensNeed = (sent: ReadonlySet<string>, state: SliceState): boolean =>
  [...state.needs.keys()].some((id) => !sent.has(id));
