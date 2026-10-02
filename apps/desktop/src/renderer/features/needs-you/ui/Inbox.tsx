/**
 * The sidebar's "Needs you" view across every Host (Paper 1G2-0): a card per waiting session,
 * approvals answered inline, questions shown and answered in the conversation; then "Also
 * waiting on you" with one action each; answers another device gave, for a minute.
 */
import type { SessionId } from "@polaris/protocol";
import {
  EmptyState,
  NeedsYouCard,
  PixelFailedIcon,
  PixelHandIcon,
  PixelCheckIcon,
  PixelTerminalIcon,
  WaitingCard,
} from "@polaris/ui";
import type { ReactNode } from "react";
import { age } from "../../../shell/copy.ts";
import { useApp, useSelection, useShellActions } from "../../../shell/hooks.ts";
import { useNow } from "../../../shell/useNow.ts";
import { ReviewsGroup, useRequestedCount } from "../../pulls/index.ts";
import { useConstellationInbox, useInbox } from "../hooks.ts";
import { ConstellationGroups } from "./ConstellationGroups.tsx";
import { quietFact } from "../model/quiet.ts";
import type {
  AlsoKind,
  AlsoWaiting,
  AnsweredElsewhere,
  Place,
  WaitingSession,
} from "../model/inbox.ts";
import { approve, continueTurn, deny, retryTurn, takeBack } from "../respond.ts";

/** "Host · Workspace · age"; without `iso`, just where. */
export const where = (place: Place, iso: string | null, now: number) =>
  [place.hostLabel, place.workspace, iso === null ? null : age(iso, now)]
    .filter((part) => part !== null)
    .join(" · ");

const Title = ({
  onOpen,
  children,
}: {
  readonly onOpen: () => void;
  readonly children: string;
}) => (
  <button
    type="button"
    onClick={onOpen}
    className="hover:decoration-text-faint w-full cursor-default truncate text-left hover:underline hover:underline-offset-2"
  >
    {children || "Untitled session"}
  </button>
);

const Waiting = ({ item, now }: { readonly item: WaitingSession; readonly now: number }) => {
  const { selectSession } = useShellActions();
  const selection = useSelection();
  const { session } = item.entry;
  const request = item.requests[0];
  const target = { hostKey: item.hostKey, sessionId: session.id, requestId: request?.id ?? "" };
  const open = () => selectSession({ hostKey: item.hostKey, sessionId: session.id });
  const more = item.requests.length > 1 ? ` · ${item.requests.length} waiting` : "";

  if (request === undefined) return null;

  return (
    <NeedsYouCard
      data-testid="needs-you-card"
      data-session={session.id}
      harness={session.harness}
      selected={selection.pane === "session" && selection.sessionId === session.id}
      title={<Title onOpen={open}>{session.title}</Title>}
      where={`${where(item, item.since, now)}${more}`}
      {...(request.kind === "question"
        ? { question: request.title }
        : {
            approval: {
              command: request.detail ?? request.title,
              onApprove: () => void approve(target),
              onAlwaysAllow: () => void approve(target, true),
              onDeny: () => void deny(target),
            },
          })}
    />
  );
};

const ALSO: Record<AlsoKind, { readonly icon: ReactNode; readonly action: string }> = {
  failed: { icon: <PixelFailedIcon size={14} />, action: "Retry" },
  "in-terminal": { icon: <PixelTerminalIcon size={14} />, action: "Take back" },
  interrupted: { icon: <PixelHandIcon size={14} className="text-needs-you" />, action: "Continue" },
};

const alsoDetail = (item: AlsoWaiting): string => {
  if (item.kind === "failed")
    return `Failed · ${item.entry.session.lastError ?? "the Turn errored"}`;

  return item.kind === "in-terminal" ? "In your terminal" : "Interrupted when the daemon stopped";
};

const Also = ({ item }: { readonly item: AlsoWaiting }) => {
  const { selectSession } = useShellActions();
  const { session } = item.entry;
  const id: SessionId = session.id;

  const setupFailed =
    item.kind === "failed" &&
    session.worktreeSetup?.status === "failed" &&
    session.lastError?.startsWith("Worktree setup failed:") === true;

  const open = () => selectSession({ hostKey: item.hostKey, sessionId: id });

  const run = () => {
    if (setupFailed) open();
    else if (item.kind === "in-terminal") void takeBack(item.hostKey, id);
    else if (item.kind === "interrupted") void continueTurn(item.hostKey, id);
    // Failed with no Failed Turn (the Harness never started one): the toast says why; open it.
    else void retryTurn(item.hostKey, id).then((ok) => ok || open());
  };

  return (
    <WaitingCard
      data-testid="waiting-card"
      kind={item.kind}
      icon={ALSO[item.kind].icon}
      title={<Title onOpen={open}>{session.title}</Title>}
      detail={alsoDetail(item)}
      action={{ label: setupFailed ? "Open setup" : ALSO[item.kind].action, onAction: run }}
    />
  );
};

const DECISIONS: Record<AnsweredElsewhere["resolution"]["decision"], string> = {
  Allow: "Approved",
  Deny: "Denied",
  Answer: "Answered",
};

const Answered = ({ item }: { readonly item: AnsweredElsewhere }) => (
  <div
    data-testid="answered-elsewhere"
    className="rounded-card border-hairline bg-surface-raised flex flex-col gap-px border px-3 py-2.5"
  >
    <p className="text-label text-text-default truncate">
      {item.entry.session.title || "Untitled session"}
    </p>
    <p className="text-caption text-text-subtle truncate">
      {DECISIONS[item.resolution.decision]} on {item.resolution.resolvedBy} ·{" "}
      {item.resolution.request.title}
    </p>
  </div>
);

const Empty = () => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);

  return (
    <EmptyState
      data-testid="needs-you-empty"
      icon={<PixelCheckIcon size={24} className="text-text-strong" />}
      title="Nothing needs you"
      fact={quietFact({ hosts: hosts.length, models: Object.values(models) })}
    />
  );
};

export const NeedsYouInbox = () => {
  const all = useInbox();
  const constellations = useConstellationInbox();
  const now = useNow(30_000);
  const reviews = useRequestedCount();

  // Constellation sessions are shown under their Lead instead.
  const inbox = {
    ...all,
    waiting: all.waiting.filter((w) => !constellations.sessions.has(w.key)),
    also: all.also.filter((a) => !constellations.sessions.has(a.key)),
  };

  const nothing =
    constellations.groups.length === 0 &&
    inbox.waiting.length === 0 &&
    inbox.also.length === 0 &&
    inbox.answered.length === 0 &&
    reviews === 0;

  if (nothing) return <Empty />;

  return (
    <div className="flex flex-col gap-2 px-2 pt-2 pb-4" data-testid="needs-you-inbox">
      {inbox.answered.map((item) => (
        <Answered key={item.key} item={item} />
      ))}
      <ConstellationGroups groups={constellations.groups} now={now} />
      {inbox.waiting.length > 0 && constellations.groups.length > 0 ? (
        <p className="text-caption text-text-subtle px-1.5 pt-2.5 pb-0.5">Sessions</p>
      ) : null}
      {inbox.waiting.map((item) => (
        <Waiting key={item.key} item={item} now={now} />
      ))}
      {inbox.also.length === 0 ? null : (
        <p className="text-caption text-text-subtle px-1.5 pt-2.5 pb-0.5">Also waiting on you</p>
      )}
      {inbox.also.map((item) => (
        <Also key={item.key} item={item} />
      ))}
      <ReviewsGroup />
    </div>
  );
};
