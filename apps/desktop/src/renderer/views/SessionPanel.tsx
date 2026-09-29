import type { ApprovalRequest, TurnItem } from "@polaris/protocol";
import { Match } from "effect";
import { Commands, Decisions, newCommandId } from "../commands.ts";
import type { LiveItem, TurnView } from "../store/sessionModel.ts";
import { sessionKey } from "../store/store.ts";
import type { Selection } from "./App.tsx";
import { sessionStateLabel } from "./copy.ts";
import { useApp, useSessionFeed } from "./hooks.ts";

const itemSummary = (item: TurnItem): string =>
  Match.value(item).pipe(
    Match.tagsExhaustive({
      AssistantMessage: (i) => i.text,
      Reasoning: (i) => i.text,
      CommandExecution: (i) => `$ ${i.command}`,
      FileChange: (i) => i.changes.map((c) => `${c.kind} ${c.path}`).join(", "),
      ToolCall: (i) => i.name,
      Plan: (i) => i.steps.map((s) => s.text).join(" · "),
      Error: (i) => i.message,
    })
  );

const LIVE_TAIL = 480;

const liveText = (live: LiveItem) => {
  const text = live.text + live.output;

  return text.length > LIVE_TAIL ? `…${text.slice(-LIVE_TAIL)}` : text;
};

const TurnBlock = ({ view }: { readonly view: TurnView }) => (
  <li className="turn" data-status={view.turn.status}>
    <div className="turn-header">
      <span>turn {view.turn.index + 1}</span>
      <span className="turn-status">{view.turn.status}</span>
      <span className="turn-count" data-testid="turn-items">
        {view.items.length} items
      </span>
    </div>
    <ol className="items">
      {view.items.map((item) => (
        <li key={item.id} className="item" data-kind={item._tag}>
          {itemSummary(item).slice(0, 200)}
        </li>
      ))}
      {[...view.live].map(([id, live]) => (
        <li key={id} className="item live" data-testid="live-item">
          {liveText(live)}
        </li>
      ))}
    </ol>
  </li>
);

const Approval = ({
  hostKey,
  request,
}: {
  readonly hostKey: string;
  readonly request: ApprovalRequest;
}) => {
  const respond = (decision: Parameters<typeof Commands.RespondToApproval>[0]["decision"]) =>
    void window.polaris.request("dispatch", {
      hostKey,
      commandId: newCommandId(),
      command: Commands.RespondToApproval({
        sessionId: request.sessionId,
        requestId: request.id,
        decision,
      }),
    });

  return (
    <div className="approval">
      <span>{request.title}</span>
      <button
        type="button"
        className="button"
        onClick={() => respond(Decisions.Allow({ remember: false }))}
      >
        Allow
      </button>
      <button
        type="button"
        className="button quiet"
        onClick={() => respond(Decisions.Deny({ reason: null }))}
      >
        Deny
      </button>
    </div>
  );
};

/** The open Agent Session: its Turns, completed items, and items still streaming. */
export const SessionPanel = ({ selection }: { readonly selection: Selection | null }) => {
  useSessionFeed(selection?.hostKey ?? "", selection?.sessionId ?? null);

  const model = useApp((s) =>
    selection === null ? undefined : s.sessions[sessionKey(selection.hostKey, selection.sessionId)]
  );

  if (selection === null) {
    return <section className="output empty">Select an agent session.</section>;
  }

  if (model?.session == null) {
    return <section className="output empty">Loading…</section>;
  }

  const { session } = model;

  return (
    <section className="output" aria-label={session.title} data-testid="session-panel">
      <header className="output-header">
        <span className="output-title">{session.title || "untitled"}</span>
        <span className="session-state" data-testid="session-state" data-state={session.state}>
          {sessionStateLabel[session.state]}
        </span>
      </header>
      {model.pendingApprovals.map((request) => (
        <Approval key={request.id} hostKey={selection.hostKey} request={request} />
      ))}
      <ol className="turns">
        {model.turns.map((view) => (
          <TurnBlock key={view.turn.id} view={view} />
        ))}
      </ol>
    </section>
  );
};
