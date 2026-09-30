import type { Worktree } from "@polaris/protocol";
import { BranchIcon, cn, Row } from "@polaris/ui";
import type { KeyboardEvent, ReactElement } from "react";
import { slots } from "../../app/slots.tsx";
import type { SessionEntry } from "../../store/hostModel.ts";
import { needsYou, shownState } from "../../routes/topBar.ts";
import { age, sessionLine, sessionStateLabel } from "../copy.ts";
import { SessionGlyph, SessionTile } from "../glyphs.tsx";
import { useApp, useSelection, useShellActions } from "../hooks.ts";

export interface SessionRowProps {
  readonly hostKey: string;
  readonly entry: SessionEntry;
  readonly now: number;
}

/** Row's `asChild` can't slot (it renders several children), so the row itself is the button. */
/** ↑/↓ move focus to the previous or next session row in the same sidebar. */
const moveFocus = (from: HTMLElement, by: number) => {
  const rows = [
    ...(from.closest("aside")?.querySelectorAll<HTMLElement>("[data-session-row]") ?? []),
  ];

  const next = rows[rows.indexOf(from) + by];

  next?.focus();
};

const buttonProps = (select: () => void) => ({
  role: "button",
  tabIndex: 0,
  "data-session-row": "",
  onClick: select,
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);

      return;
    }

    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    select();
  },
});

/** A row that needs you gets its hover card (the NeedsYouHover slot). */
const WithHover = ({
  hostKey,
  entry,
  children,
}: {
  readonly hostKey: string;
  readonly entry: SessionEntry;
  readonly children: ReactElement;
}) =>
  needsYou(entry) ? (
    <slots.NeedsYouHover hostKey={hostKey} sessionId={entry.session.id}>
      {children}
    </slots.NeedsYouHover>
  ) : (
    children
  );

const useSelectedSession = (hostKey: string, entry: SessionEntry) => {
  const selection = useSelection();

  return (
    selection.pane === "session" &&
    selection.hostKey === hostKey &&
    selection.sessionId === entry.session.id
  );
};

/** DESIGN.md, Session rows: Harness tile with the state inside, title, what it's doing, age. */
export const SessionRow = ({ hostKey, entry, now }: SessionRowProps) => {
  const { selectSession } = useShellActions();
  const density = useApp((s) => s.density);
  const selected = useSelectedSession(hostKey, entry);
  const { session } = entry;
  const state = shownState(entry);

  return (
    <WithHover hostKey={hostKey} entry={entry}>
      <Row
        {...buttonProps(() => selectSession({ hostKey, sessionId: session.id }))}
        aria-current={selected}
        data-state={state}
        variant="session"
        selected={selected}
        tone={needsYou(entry) ? "needs-you" : session.state === "dormant" ? "quiet" : "default"}
        leading={<SessionTile state={state} harness={session.harness} density={density} />}
        title={session.title || "Untitled session"}
        description={sessionLine(entry)}
        meta={
          <span data-testid="row-state" data-state={state} aria-label={sessionStateLabel[state]}>
            {age(session.createdAt, now)}
          </span>
        }
      />
    </WithHover>
  );
};

/** A compact one-line session row (machine groups, "Needs you elsewhere"). */
export const CompactSessionRow = ({
  hostKey,
  entry,
  meta,
}: SessionRowProps & { readonly meta: string }) => {
  const { selectSession } = useShellActions();
  const selected = useSelectedSession(hostKey, entry);
  const state = shownState(entry);

  return (
    <WithHover hostKey={hostKey} entry={entry}>
      <Row
        {...buttonProps(() => selectSession({ hostKey, sessionId: entry.session.id }))}
        aria-current={selected}
        data-state={state}
        selected={selected}
        tone={needsYou(entry) ? "needs-you" : "default"}
        leading={<SessionGlyph state={state} harness={entry.session.harness} size={14} />}
        title={entry.session.title || "Untitled session"}
        meta={meta}
      />
    </WithHover>
  );
};

/** Worktrees a session created, nested under its row as tree rows. */
export const WorktreeRows = ({ worktrees }: { readonly worktrees: ReadonlyArray<Worktree> }) =>
  worktrees.length === 0 ? null : (
    <ul className="flex flex-col pl-[calc(var(--density-harness-tile)+var(--density-row-x))]">
      {worktrees.map((wt) => (
        <li
          key={wt.id}
          title={wt.path}
          className={cn(
            "flex h-tree-row items-center gap-1.5 px-row-x text-caption text-text-subtle"
          )}
        >
          <BranchIcon size={12} className="text-text-faint shrink-0" />
          <span className="text-code-inline truncate font-mono">
            {wt.branch ?? wt.head.slice(0, 7)}
          </span>
        </li>
      ))}
    </ul>
  );
