/**
 * The Constellation tab in a Lead's Output (DESIGN.md, Constellation (DAG)): the header, the
 * rail list (virtualized), filters past 100 Tasks, the key-hint row, the empty state (C7).
 */
import { AnswerAction } from "@polaris/protocol";
import { Button, cn, ContextMenu, ContextMenuTrigger, EmptyState } from "@polaris/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { openSessionReview } from "../../../routes/review.ts";
import { useApp, useCommands, useShellActions } from "../../../shell/hooks.ts";
import { constellationCommands } from "../client.ts";
import { useFacts, useLeadBranch } from "../hooks.ts";
import { hostKeyOf } from "../liveFacts.ts";
import {
  type AttentionItem,
  attentionItems,
  buildRail,
  foldsAbove,
  railStep,
  type ConstellationRecord,
  LANE_MAX,
  laneWidth,
  nextNeedingYou,
  type RailRow,
  retrySetup,
  segments,
  type TaskRow,
} from "../model/index.ts";
import { type KeyAction, railKey } from "../model/keys.ts";
import { leadKey, type LeadUi, patchLeadUi, useLeadUi } from "../state.ts";
import { ConstellationMark } from "./glyphs.tsx";
import { laneStyle } from "./lane.tsx";
import { Filters, Header, KeyHints } from "./header.tsx";
import { CompletionCard } from "./stats.tsx";
import { approveClaim, placeOf } from "./claimActions.ts";
import { type MenuActions, RowContextMenu, RowMenu } from "./menu.tsx";
import { type MessageDraft, MessageLeadDialog } from "./MessageLead.tsx";
import { type RowHandlers, RowView } from "./rows.tsx";

export interface ConstellationTabProps {
  /** The Lead's Host, where the Constellation lives. */
  readonly hostKey: string;
  readonly record: ConstellationRecord;
}

const ESTIMATE = 30;

/** The row the Intent column shows, which keeps a translucent fill. */
const focusKey = ({ focus }: LeadUi) => {
  if (focus === null) return null;

  return focus.kind === "task" ? `task:${focus.taskId}` : `handover:${focus.revision}`;
};

const lastHint = (row: RailRow | undefined) =>
  row?.kind === "task" && row.projection.state === "review"
    ? "a accept or send back"
    : "m message lead";

/** Scrolls a row into view once the virtualizer knows where it is. */
const indexOf = (rows: ReadonlyArray<RailRow>, key: string) => rows.findIndex((r) => r.key === key);

const useTabActions = (
  props: ConstellationTabProps,
  setDraft: (d: MessageDraft | null) => void
) => {
  const { hostKey, record } = props;
  const c = record.constellation;
  const key = leadKey(hostKey, c.leadSessionId);
  const shell = useShellActions();
  const hosts = useApp((s) => s.hosts);
  const commands = useCommands();
  const leadBranch = useLeadBranch(hostKey, c.leadSessionId);

  const focus = (row: TaskRow) =>
    patchLeadUi(key, () => ({ focus: { kind: "task", taskId: row.task.id }, selected: row.key }));

  const menu: MenuActions = {
    onFocus: focus,
    onReview: (row, mode) => {
      if (row.attempt === null) return;
      patchLeadUi(key, () => ({
        focus: { kind: "task", taskId: row.task.id },
        selected: row.key,
        review: { attemptId: row.attempt?.id ?? "", mode },
      }));
    },
    onOpenInReview: (row) => {
      const worker = row.attempt === null ? null : hostKeyOf(hosts, row.attempt.hostId);

      if (worker !== null && row.attempt !== null)
        openSessionReview(shell, worker, row.attempt.sessionId);
    },
    onApprove: (row) => {
      if (row.attempt === null) return;
      void approveClaim(hostKey, record, row.attempt, placeOf(row.attempt, leadBranch));
    },
    onMessageLead: (row, authority) =>
      setDraft({
        title: `Message the lead about ${row.task.id}`,
        authority,
        text: `About ${row.task.id} (${row.task.title}): `,
      }),
  };

  const answer = (proposalId: string, accept: boolean) =>
    void constellationCommands.answer(
      hostKey,
      {
        constellationId: c.id,
        action: AnswerAction.cases.Proposal.make({ proposalId, accept, reason: "" }),
      },
      accept ? "Couldn't accept the proposal" : "Couldn't decline the proposal"
    );

  const retry = (row: TaskRow) => {
    if (row.setup === null) return;
    void constellationCommands.dispatch(
      hostKey,
      retrySetup(row.setup, c.hostId),
      `Couldn't retry ${row.task.id}`
    );
  };

  const toggle = (group: string, open: boolean) =>
    patchLeadUi(key, (ui) => ({ folds: new Map(ui.folds).set(group, open) }));

  const messageLead = () => {
    patchLeadUi(key, () => ({ focus: null }));
    commands.run("session.focusComposer");
  };

  return { key, menu, answer, retry, toggle, focus, messageLead };
};

type Actions = ReturnType<typeof useTabActions>;

const runKey = (
  action: KeyAction,
  ctx: {
    readonly actions: Actions;
    readonly ui: LeadUi;
    readonly items: ReadonlyArray<AttentionItem>;
    readonly jump: (taskId: string) => void;
    readonly filter: () => void;
  }
) => {
  const { actions } = ctx;

  switch (action.kind) {
    case "select":
      return patchLeadUi(actions.key, () => ({ selected: action.key }));
    case "focus":
      return actions.focus(action.row);
    case "toggle":
      return actions.toggle(action.group, action.open);
    case "handover":
      return patchLeadUi(actions.key, () => ({
        focus: { kind: "handover", revision: action.revision },
      }));
    case "review":
      return actions.menu.onReview(action.row, action.mode);
    case "next-needs-you": {
      const selected = ctx.ui.selected?.replace(/^task:/, "") ?? null;
      const next = nextNeedingYou(ctx.items, selected);

      return next === null ? undefined : ctx.jump(next);
    }

    case "message-lead":
      return actions.messageLead();
    case "filter":
      return ctx.filter();
    case "back":
      return patchLeadUi(actions.key, () => ({ focus: null, review: null }));
  }
};

const Empty = ({ onAdd }: { readonly onAdd: () => void }) => (
  <div className="grid flex-1 place-items-center" data-testid="constellation-empty">
    <EmptyState
      icon={<ConstellationMark size={24} />}
      title="No tasks yet"
      fact="The lead is drafting a plan. Tasks appear here as it adds them."
      action={
        <Button variant="secondary" onClick={onAdd}>
          Add a task
        </Button>
      }
    />
  </div>
);

export const ConstellationTab = (props: ConstellationTabProps) => {
  const { hostKey, record } = props;
  const c = record.constellation;
  const [draft, setDraft] = useState<MessageDraft | null>(null);
  const actions = useTabActions(props, setDraft);
  const ui = useLeadUi(actions.key);
  const facts = useFacts(record);
  const scrollRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const rail = useMemo(
    () => buildRail(record, facts, { folds: ui.folds, filter: ui.filter, query: ui.query }),
    [record, facts, ui.folds, ui.filter, ui.query]
  );

  const items = useMemo(() => attentionItems(rail.tasks, facts), [rail, facts]);
  const strip = useMemo(() => segments(rail.tasks), [rail]);
  const { rows } = rail;
  const step = railStep(rail.depth);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATE,
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 8,
    paddingStart: 2,
    paddingEnd: 16,
  });

  const jump = (taskId: string) => {
    const rowKey = `task:${taskId}`;

    for (const fold of foldsAbove(record, taskId)) actions.toggle(fold, true);
    patchLeadUi(actions.key, () => ({ selected: rowKey }));
    requestAnimationFrame(() => {
      const at = indexOf(rail.rows, rowKey);

      if (at >= 0) virtualizer.scrollToIndex(at, { align: "auto" });
    });
  };

  const onJump = (item: AttentionItem) => (item.taskId === null ? undefined : jump(item.taskId));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey)
      return;
    const action = railKey(event.key, rows, ui.selected);

    if (action === null || (action.kind === "next-needs-you" && items.length === 0)) return;
    event.preventDefault();
    runKey(action, { actions, ui, items, jump, filter: () => filterRef.current?.focus() });

    if (action.kind === "select") {
      const at = indexOf(rows, action.key);

      if (at >= 0) virtualizer.scrollToIndex(at, { align: "auto" });
    }
  };

  const handlers: RowHandlers = {
    onToggleGroup: (group) => {
      const header = rows.find(
        (r) =>
          (r.kind === "group" && r.group === group) || (r.kind === "parent" && r.fold === group)
      );

      actions.toggle(
        group,
        header?.kind === "group" || header?.kind === "parent" ? !header.open : true
      );
    },
    onFocus: actions.focus,
    onReview: actions.menu.onReview,
    onApprove: actions.menu.onApprove,
    onRetrySetup: actions.retry,
    onProposal: actions.answer,
    onHandover: (revision) =>
      patchLeadUi(actions.key, () => ({ focus: { kind: "handover", revision } })),
    menu: (row) => (
      <RowMenu
        row={row}
        on={actions.menu}
        open={ui.menu === row.key}
        onOpenChange={(open) => patchLeadUi(actions.key, () => ({ menu: open ? row.key : null }))}
      />
    ),
  };

  const focusedKey = focusKey(ui);

  return (
    <section
      aria-label={`Constellation ${c.name}`}
      className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-testid="constellation-tab"
    >
      <Header
        record={record}
        segments={strip}
        top={items[0] ?? null}
        onJump={onJump}
        hostKey={hostKey}
        statsOpen={ui.stats}
        onStatsOpen={(stats) => patchLeadUi(actions.key, () => ({ stats }))}
        ledBy="led by this session"
      />
      {c.state === "completed" || c.state === "archived" ? (
        <CompletionCard hostKey={hostKey} record={record} />
      ) : null}
      {rail.large ? (
        <Filters
          rail={rail}
          filter={ui.filter}
          query={ui.query}
          onFilter={(filter) => patchLeadUi(actions.key, () => ({ filter }))}
          onQuery={(query) => patchLeadUi(actions.key, () => ({ query }))}
          inputRef={filterRef}
        />
      ) : null}
      {c.tasks.length === 0 && record.proposals.length === 0 ? (
        <Empty
          onAdd={() =>
            setDraft({ title: "Add a task", authority: "conversation", text: "Add a task: " })
          }
        />
      ) : (
        <div
          ref={scrollRef}
          role="list"
          aria-label="Tasks"
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1"
          style={laneStyle(laneWidth(rail.ids, LANE_MAX.tab))}
          data-testid="constellation-rail"
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];

              if (row === undefined) return null;
              const selected = row.key === ui.selected || row.key === focusedKey;

              const body = (
                <div
                  role="listitem"
                  aria-current={selected ? "true" : undefined}
                  data-selected={selected ? "" : undefined}
                  className={cn(
                    "group/row rounded-row",
                    selected && "bg-fill-selected/60",
                    row.kind === "task" && "hover:bg-fill-hover/60"
                  )}
                  onClick={(e) => {
                    if (e.target instanceof Element && e.target.closest("button") !== null) return;
                    patchLeadUi(actions.key, () => ({ selected: row.key }));

                    if (row.kind === "task") actions.focus(row);
                  }}
                >
                  <RowView row={row} on={handlers} large={rail.large} step={step} />
                </div>
              );

              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {row.kind === "task" && row.attempt !== null ? (
                    <ContextMenu>
                      <ContextMenuTrigger asChild>{body}</ContextMenuTrigger>
                      <RowContextMenu row={row} on={actions.menu} />
                    </ContextMenu>
                  ) : (
                    body
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <KeyHints
        last={
          ui.focus?.kind === "task"
            ? "m message lead"
            : lastHint(rows.find((r) => r.key === ui.selected))
        }
      />
      <MessageLeadDialog
        hostKey={hostKey}
        constellationId={c.id}
        draft={draft}
        onClose={() => setDraft(null)}
      />
    </section>
  );
};
