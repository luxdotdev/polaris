/**
 * The Needs You hover card (Paper 1-0): hover a waiting session's row, or a Workspace chip
 * with one waiting, and answer without opening it. Approvals show the command in a well with
 * Approve / Always here / Deny; questions show the question and its numbered answers.
 */
import type { SessionId, WorkspaceId } from "@polaris/protocol";
import {
  ApprovalCard,
  Button,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  harnessHue,
  QuestionCard,
} from "@polaris/ui";
import type { ReactElement } from "react";
import { useShellActions } from "../../../shell/hooks.ts";
import { useNow } from "../../../shell/useNow.ts";
import { age } from "../../../shell/copy.ts";
import { useInboxUntimed } from "../hooks.ts";
import type { WaitingSession } from "../model/inbox.ts";
import { answer, approve, deny } from "../respond.ts";
import { where } from "./Inbox.tsx";

export interface NeedsYouHoverProps {
  readonly hostKey: string;
  /** A session row: that session's first request. */
  readonly sessionId?: SessionId;
  /** A Workspace chip: the longest-waiting session in it. */
  readonly workspaceId?: WorkspaceId;
  readonly children: ReactElement;
}

const KIND_WANTS = {
  command: "wants to run a command",
  "file-change": "wants to change files",
  tool: "wants to use a tool",
  question: "has a question",
} as const;

const Card = ({ item }: { readonly item: WaitingSession }) => {
  const now = useNow(30_000);
  const { selectSession } = useShellActions();
  const { session } = item.entry;
  const request = item.requests[0];

  if (request === undefined) return null;
  const target = { hostKey: item.hostKey, sessionId: session.id, requestId: request.id };
  const name = harnessHue(session.harness).name;
  const open = () => selectSession({ hostKey: item.hostKey, sessionId: session.id });

  if (request.kind === "question") {
    return (
      <div className="flex flex-col">
        <QuestionCard
          className="rounded-none border-0"
          harness={session.harness}
          age={age(request.openedAt, now)}
          question={request.title}
          {...(request.detail === null ? {} : { context: request.detail })}
          answers={request.options.map((label) => ({ label }))}
          onAnswer={(index) => void answer(target, request.options[index] ?? "")}
        />
        {request.options.length === 0 ? (
          <div className="border-hairline flex justify-end border-t px-3.5 py-2.5">
            <Button onClick={open}>Answer in the conversation</Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <ApprovalCard
      harness={session.harness}
      title={session.title || "Untitled session"}
      summary={`${name} ${KIND_WANTS[request.kind]} · ${age(request.openedAt, now)}`}
      command={request.detail ?? request.title}
      where={where(item, null, now)}
      onApprove={() => void approve(target)}
      onAlwaysAllow={() => void approve(target, true)}
      onDeny={() => void deny(target)}
    />
  );
};

const useWaiting = ({ hostKey, sessionId, workspaceId }: Omit<NeedsYouHoverProps, "children">) => {
  const inbox = useInboxUntimed();

  return inbox.waiting.find(
    (w) =>
      w.hostKey === hostKey &&
      (sessionId === undefined || w.entry.session.id === sessionId) &&
      (workspaceId === undefined || w.entry.session.workspaceId === workspaceId)
  );
};

export const NeedsYouHover = ({ children, ...target }: NeedsYouHoverProps) => {
  const item = useWaiting(target);

  if (item === undefined) return children;

  return (
    <HoverCard openDelay={350} closeDelay={150}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" sideOffset={8} data-testid="needs-you-hover">
        <Card item={item} />
      </HoverCardContent>
    </HoverCard>
  );
};
