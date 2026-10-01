/**
 * The Review header's primary action for an Agent Session (Paper R2's "Accept split
 * button", 24I-0): accept the Turns since the last accept, paused while a Critical finding
 * is open; the chevron accepts through an earlier Turn or overrides the pause. Once the
 * work is a pull request, it opens it and sends its review comments as the next Turn.
 */
import type { TurnId } from "@polaris/protocol";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  harnessHue,
  Popover,
  PopoverAnchor,
  PixelCheckIcon,
  PopoverContent,
  showToast,
} from "@polaris/ui";
import { useState } from "react";
import { useStore } from "zustand";
import type { SessionSubject } from "../../../routes/review.ts";
import { useSession } from "../../session/hooks.ts";
import { branchFromPrompt } from "../../session/model/newSession.ts";
import { useSettings } from "../../settings/store.ts";
import { surfaceStore, subjectKey, type ReviewSlotProps } from "../../review/surface.ts";
import { sendPullComments } from "../data/pullComments.ts";
import { type HeaderAction, headerAction, type PendingTurn, turnsLabel } from "../model/action.ts";
import { pullUrl } from "../model/linked.ts";
import { AcceptPanel } from "./AcceptPanel.tsx";
import { useAcceptPanel } from "./useAcceptPanel.ts";

const Chevron = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" />
  </svg>
);

/** Accepting is the view's one primary fill; paused and waiting read as disabled (R2). */
const FILLS: Readonly<Record<HeaderAction["kind"], string>> = {
  accept: "bg-text-strong text-bg",
  linked: "bg-fill-selected text-text-default",
  paused: "bg-fill-selected text-text-subtle",
  working: "bg-fill-selected text-text-subtle",
  none: "",
};

const SPLIT = "rounded-control flex h-[30px] items-center overflow-clip text-label";

const PanelBody = ({
  subject,
  through,
  turns,
}: {
  readonly subject: SessionSubject;
  readonly through: TurnId;
  readonly turns: ReadonlyArray<PendingTurn>;
}) => {
  const { session } = useSession(subject.hostKey, subject.sessionId);
  const prefix = useSettings((s) => s.sessions.branchPrefix);
  const title = session?.title ?? "session";

  const state = useAcceptPanel(
    {
      hostKey: subject.hostKey,
      sessionId: subject.sessionId,
      workspaceId: session?.workspaceId ?? "",
      title,
      linked: session?.pullRequest != null,
    },
    through
  );

  return (
    <AcceptPanel
      state={state}
      harness={session === null ? "The agent" : harnessHue(session.harness).name}
      turns={turns}
      newBranchName={branchFromPrompt(title, subject.sessionId, prefix)}
    />
  );
};

export const AcceptAction = ({ subject }: ReviewSlotProps) => {
  if (subject.kind !== "session") return null;

  return <SessionAccept subject={subject} />;
};

const SessionAccept = ({ subject }: { readonly subject: SessionSubject }) => {
  const model = useSession(subject.hostKey, subject.sessionId);
  const findings = useStore(surfaceStore, (s) => s[subjectKey(subject)]?.findings);
  const [open, setOpen] = useState(false);

  /** The Turn accepted through, and the Turns it takes, as they were when the popover opened. */
  const [chosen, setChosen] = useState<{
    readonly through: TurnId;
    readonly turns: ReadonlyArray<PendingTurn>;
  } | null>(null);

  const { session } = model;
  const accepted = session?.acceptedThroughIndex ?? -1;
  const pending = model.turns.map((t) => t.turn).filter((t) => t.index > accepted);

  const critical = (findings ?? []).filter(
    (f) => f.severity === "critical" && f.status === "open"
  ).length;

  const pull = session?.pullRequest ?? null;

  const action = headerAction({
    pending,
    critical,
    working: session?.state === "working" || pending.some((t) => t.status === "working"),
    pullNumber: pull?.number ?? null,
  });

  if (action.kind === "none" || session === null) return null;

  const pullRef =
    pull === null
      ? null
      : { repo: { owner: pull.repo.owner, name: pull.repo.name }, number: pull.number };

  const last = pending.at(-1);

  const openFor = (turnId: TurnId | undefined) => {
    if (turnId === undefined) return;
    const index = pending.find((t) => t.id === turnId)?.index ?? 0;

    setChosen({ through: turnId, turns: pending.filter((t) => t.index <= index) });
    setOpen(true);
  };

  const sendComments = async () => {
    if (pullRef === null) return;
    const sent = await sendPullComments(subject.hostKey, subject.sessionId, pullRef);

    showToast({
      source: session.harness,
      icon: <PixelCheckIcon size={16} />,
      title:
        sent === 0
          ? "No new review comments"
          : `Sent ${sent} review ${sent === 1 ? "comment" : "comments"}`,
      message:
        sent === 0
          ? `Nothing unresolved on #${pullRef.number} since the last send`
          : `To ${harnessHue(session.harness).name} as its next turn`,
    });
  };

  const primary = FILLS[action.kind];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          data-testid="accept-action"
          data-session-state={session.state}
          className={cn(SPLIT, primary)}
        >
          <button
            type="button"
            data-testid="accept-primary"
            disabled={action.kind === "paused" || action.kind === "working"}
            onClick={() =>
              action.kind === "linked" && pullRef !== null
                ? window.open(pullUrl(pullRef), "_blank", "noopener")
                : openFor(last?.id)
            }
            className="flex h-[30px] items-center px-3 font-medium disabled:cursor-default"
          >
            {action.label}
          </button>
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-current opacity-20" />
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="More accept options"
              className="w-tree-row flex h-[30px] shrink-0 items-center justify-center"
            >
              <Chevron />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {action.kind === "paused" && (
                <DropdownMenuItem onSelect={() => openFor(last?.id)}>
                  Accept anyway, despite {action.critical} critical
                </DropdownMenuItem>
              )}
              {pending.length > 1 &&
                pending.slice(0, -1).map((t) => (
                  <DropdownMenuItem key={t.id} onSelect={() => openFor(t.id)}>
                    Accept through turn {t.index + 1}
                  </DropdownMenuItem>
                ))}
              {pullRef !== null && (
                <>
                  {pending.length > 1 && <DropdownMenuSeparator />}
                  <DropdownMenuItem onSelect={() => void sendComments()}>
                    Send review comments to {harnessHue(session.harness).name}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => window.open(pullUrl(pullRef), "_blank", "noopener")}
                  >
                    Open #{pullRef.number} on GitHub
                  </DropdownMenuItem>
                </>
              )}
              {pending.length <= 1 && pullRef === null && action.kind !== "paused" && (
                <DropdownMenuItem disabled>Accept {turnsLabel(pending)}</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" className="w-[400px] overflow-clip p-0">
        {open && chosen !== null && (
          <PanelBody subject={subject} through={chosen.through} turns={chosen.turns} />
        )}
      </PopoverContent>
    </Popover>
  );
};
