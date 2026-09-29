import {
  type ApprovalDecision,
  type ApprovalRequest,
  isKnownHarness,
  type TurnItem,
} from "@polaris/protocol";
import { ApprovalCard } from "@polaris/ui";
import { Match } from "effect";
import { Commands, Decisions, newCommandId } from "../commands.ts";
import type { SessionData } from "../store/plain.ts";
import type { LiveItem, TurnView } from "../store/sessionModel.ts";
import { sessionKey } from "../store/store.ts";
import type { Selection } from "./App.tsx";
import { sessionStateLabel } from "./copy.ts";
import { SessionIcon } from "./SessionIcon.tsx";
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
  <li className="flex flex-col gap-1">
    <div className="text-caption text-text-subtle tabular flex gap-3">
      <span>Turn {view.turn.index + 1}</span>
      <span>{view.turn.status}</span>
      <span data-testid="turn-items">{view.items.length} items</span>
    </div>
    <ol className="text-code-inline flex flex-col gap-0.5 font-mono">
      {view.items.map((item) => (
        <li key={item.id} className="text-text-default break-all whitespace-pre-wrap">
          {itemSummary(item).slice(0, 200)}
        </li>
      ))}
      {[...view.live].map(([id, live]) => (
        <li
          key={id}
          className="text-text-subtle break-all whitespace-pre-wrap"
          data-testid="live-item"
        >
          {liveText(live)}
        </li>
      ))}
    </ol>
  </li>
);

interface ApprovalProps {
  readonly hostKey: string;
  readonly session: SessionData;
  readonly request: ApprovalRequest;
}

const Approval = ({ hostKey, session, request }: ApprovalProps) => {
  const respond = (decision: ApprovalDecision) =>
    void window.polaris.request("dispatch", {
      hostKey,
      commandId: newCommandId(),
      command: Commands.RespondToApproval({
        sessionId: request.sessionId,
        requestId: request.id,
        decision,
      }),
    });

  const { harness } = session;

  if (!isKnownHarness(harness)) {
    return <p className="text-caption text-needs-you">Needs you: {request.title}</p>;
  }

  return (
    <ApprovalCard
      harness={harness}
      title={request.title}
      summary={request.detail ?? request.kind}
      command={request.title}
      where={session.cwd}
      onApprove={() => respond(Decisions.Allow({ remember: false }))}
      onAlwaysAllow={() => respond(Decisions.Allow({ remember: true }))}
      onDeny={() => respond(Decisions.Deny({ reason: null }))}
    />
  );
};

const Placeholder = ({ children }: { readonly children: string }) => (
  <section className="text-body text-text-faint grid place-items-center">{children}</section>
);

/** The open Agent Session: its Turns, completed items, and items still streaming. */
export const SessionPanel = ({ selection }: { readonly selection: Selection | null }) => {
  useSessionFeed(selection?.hostKey ?? "", selection?.sessionId ?? null);

  const model = useApp((s) =>
    selection === null ? undefined : s.sessions[sessionKey(selection.hostKey, selection.sessionId)]
  );

  if (selection === null) return <Placeholder>Select an agent session</Placeholder>;

  if (model?.session == null) return <Placeholder>Loading…</Placeholder>;

  const { session } = model;

  return (
    <section
      aria-label={session.title}
      data-testid="session-panel"
      className="gap-section p-panel flex flex-col overflow-y-auto px-6 select-text"
    >
      <header className="flex items-center gap-3">
        <SessionIcon state={session.state} harness={session.harness} />
        <h1 className="text-title text-text-strong">{session.title || "untitled"}</h1>
        <span className="text-caption text-text-subtle" data-testid="session-state">
          {sessionStateLabel[session.state]}
        </span>
      </header>
      {model.pendingApprovals.map((request) => (
        <Approval
          key={request.id}
          hostKey={selection.hostKey}
          session={session}
          request={request}
        />
      ))}
      <ol className="flex flex-col gap-4">
        {model.turns.map((view) => (
          <TurnBlock key={view.turn.id} view={view} />
        ))}
      </ol>
    </section>
  );
};
