/**
 * A Risk Finding's right-click menu (Paper M4), in the risk column and under its line in the
 * diff: Comment on this…, Ask about this… · Helpful, Not helpful… · Copy finding.
 */
import type { RiskFindingId } from "@polaris/protocol";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuEntries,
  ContextMenuTrigger,
  MENU_SEPARATOR_ENTRY,
  type MenuEntryInput,
} from "@polaris/ui";
import { type ReactElement, useRef } from "react";
import { copyWithToast } from "../../../shell/menu/index.ts";
import { openComposer } from "../../comments/data/store.ts";
import { revealInDiff, surfaceOf } from "../../review/surface.ts";
import { setAskAbout } from "../data/ui.ts";

/** What the menu needs of a finding; both the risk model's and the diff's have it. */
export interface FindingLike {
  readonly id: string;
  readonly path: string;
  readonly lines: { readonly start: number; readonly end: number; readonly side: "new" | "old" };
  readonly title: string;
  readonly reason: string;
}

/** "Comment on this": a draft pre-filled with the reason, never posted on its own (ENG-223). */
export const commentOn = (subjectKey: string, finding: FindingLike) => {
  const range = {
    path: finding.path,
    side: finding.lines.side,
    start: finding.lines.start,
    end: finding.lines.end,
  };

  const anchor = { ...range, code: surfaceOf(subjectKey).quote?.(range) ?? "", turn: null };

  // SAFETY: finding ids come from the Daemon's RiskFinding rows, branded on the wire.
  openComposer(subjectKey, anchor, {
    text: finding.reason,
    findingId: finding.id as RiskFindingId,
  });
  revealInDiff(finding.path, finding.lines.end, finding.lines.side);
};

/** "Title", then `path:line`, then the reason: what a finding says, pasted anywhere. */
export const findingText = (finding: FindingLike) =>
  [finding.title, `${finding.path}:${finding.lines.start}`, finding.reason]
    .filter((part) => part !== "")
    .join("\n");

export interface FindingVerdicts {
  readonly helpful: () => void;
  /** Opens the thumbs-down form, which asks why. */
  readonly notHelpful: () => void;
}

export const FindingMenu = ({
  subjectKey,
  finding,
  verdicts,
  children,
}: {
  readonly subjectKey: string;
  readonly finding: FindingLike;
  /** Unset where no Summary is at hand (the diff): the thumbs are left out. */
  readonly verdicts?: FindingVerdicts;
  readonly children: ReactElement;
}) => {
  // A row that opens a field keeps the focus there rather than on the finding.
  const asking = useRef(false);

  const ask = (run: () => void) => () => {
    asking.current = true;
    run();
  };

  const entries: ReadonlyArray<MenuEntryInput> = [
    {
      kind: "item",
      label: "Comment on this…",
      needsInput: true,
      onSelect: ask(() => commentOn(subjectKey, finding)),
    },
    {
      kind: "item",
      label: "Ask about this…",
      needsInput: true,
      onSelect: ask(() => setAskAbout(subjectKey, finding.id)),
    },
    MENU_SEPARATOR_ENTRY,
    verdicts !== undefined && { kind: "item", label: "Helpful", onSelect: verdicts.helpful },
    verdicts !== undefined && {
      kind: "item",
      label: "Not helpful…",
      needsInput: true,
      onSelect: ask(verdicts.notHelpful),
    },
    MENU_SEPARATOR_ENTRY,
    {
      kind: "item",
      label: "Copy finding",
      onSelect: () => copyWithToast(findingText(finding), "finding"),
    },
  ];

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        data-testid="finding-menu"
        onCloseAutoFocus={(event) => {
          if (asking.current) event.preventDefault();
          asking.current = false;
        }}
      >
        <ContextMenuEntries entries={entries} />
      </ContextMenuContent>
    </ContextMenu>
  );
};
