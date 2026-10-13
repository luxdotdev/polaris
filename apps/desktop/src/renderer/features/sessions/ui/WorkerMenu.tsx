/**
 * A worker row's right-click menu (Paper M2): Focus B1, Open in Review · Message the lead
 * about this ▸ · Copy task ID.
 */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuEntries,
  ContextMenuTrigger,
  MENU_SEPARATOR_ENTRY,
  type MenuEntryInput,
} from "@polaris/ui";
import type { MessageAuthority } from "@polaris/protocol";
import type { ReactElement } from "react";
import { openSessionReview } from "../../../routes/review.ts";
import { useShellActions } from "../../../shell/hooks.ts";
import { copyEntry } from "../../../shell/menu/index.ts";
import { showOutput } from "../../session/output/actions.ts";
import type { LeadGroup, LeadWorker } from "../model/leadGroups.ts";
import { useConstellationActions } from "../source.ts";

export interface WorkerMenuProps {
  readonly hostKey: string;
  readonly group: LeadGroup;
  readonly row: LeadWorker;
  readonly onFocus: () => void;
  readonly children: ReactElement;
}

export const WorkerMenu = ({ hostKey, group, row, onFocus, children }: WorkerMenuProps) => {
  const shell = useShellActions();
  const { messageLead } = useConstellationActions();
  const lead = group.lead.session;

  const message = (authority: MessageAuthority) => {
    showOutput({ hostKey, workspaceId: lead.workspaceId }, lead.id);
    messageLead({
      hostKey,
      leadSessionId: lead.id,
      taskId: row.taskId,
      title: row.title,
      authority,
    });
  };

  const workerHost = row.hostKey;

  const entries: ReadonlyArray<MenuEntryInput> = [
    { kind: "item", label: `Focus ${row.taskId}`, onSelect: onFocus },
    row.kind === "attempt" &&
      workerHost !== null && {
        kind: "item",
        label: "Open in Review",
        onSelect: () => openSessionReview(shell, workerHost, row.sessionId),
      },
    MENU_SEPARATOR_ENTRY,
    {
      kind: "sub",
      label: "Message the lead about this",
      testId: "menu-message-lead",
      entries: [
        {
          kind: "item",
          label: "Ask for a recommendation",
          onSelect: () => message("recommend_and_return"),
        },
        {
          kind: "item",
          label: "Let it decide",
          onSelect: () => message("may_decide_and_continue"),
        },
      ],
    },
    copyEntry("Copy task ID", row.taskId),
  ];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent data-testid="worker-context-menu">
        <ContextMenuEntries entries={entries} />
      </ContextMenuContent>
    </ContextMenu>
  );
};
