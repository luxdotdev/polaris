/**
 * A Risk Finding in the risk column (Paper R1 1WG-0): a row with its Severity badge in a
 * fixed slot, the title and `file · source · confidence`; selected, a card with the reason
 * on a hanging indent, `file:line`, the Verdict thumbs, "Comment on this" and "Ask about this".
 */
import type { Verdict } from "@polaris/protocol";
import { Button, cn, SeverityBadge, ThumbUpIcon } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { Plain } from "../../../store/plain.ts";
import { openComposer } from "../../comments/index.ts";
import { revealInDiff, surfaceOf, updateSurface } from "../../review/index.ts";
import { earlierVerdicts, recordVerdict } from "../data/actions.ts";
import { setAskAbout } from "../data/ui.ts";
import {
  fileName,
  type Finding,
  isDimmed,
  placeOf,
  provenanceOf,
  type Summary,
} from "../model/summary.ts";
import { historyLine } from "../model/verdict.ts";
import { ThumbDown, type VerdictDraft } from "./VerdictPopover.tsx";

export interface FindingItemProps {
  readonly subjectKey: string;
  readonly hostKey: string;
  readonly summary: Summary;
  readonly finding: Finding;
  readonly selected: boolean;
}

const SEVERITY_BORDER: Readonly<Record<Finding["severity"], string>> = {
  critical: "border-[color-mix(in_oklab,var(--color-severity-critical)_30%,transparent)]",
  high: "border-[color-mix(in_oklab,var(--color-severity-high)_22%,transparent)]",
  medium: "border-[color-mix(in_oklab,var(--color-severity-medium)_22%,transparent)]",
  low: "border-hairline",
};

const select = (subjectKey: string, finding: Finding) => {
  const already = surfaceOf(subjectKey).selectedFinding === finding.id;

  updateSurface(subjectKey, { selectedFinding: already ? null : finding.id });

  if (!already) revealInDiff(finding.path, finding.lines.end, finding.lines.side);
};

/** "Comment on this": a draft pre-filled with the reason, never posted on its own (ENG-223). */
const commentOn = (subjectKey: string, finding: Finding) => {
  const range = {
    path: finding.path,
    side: finding.lines.side,
    start: finding.lines.start,
    end: finding.lines.end,
  };

  const anchor = { ...range, code: surfaceOf(subjectKey).quote?.(range) ?? "", turn: null };

  openComposer(subjectKey, anchor, { text: finding.reason, findingId: finding.id });
  revealInDiff(finding.path, finding.lines.end, finding.lines.side);
};

const useHistory = (hostKey: string, finding: Finding, active: boolean) => {
  const [history, setHistory] = useState<Plain<Verdict> | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    let current = true;

    void earlierVerdicts(hostKey, finding.identity).then((verdicts) => {
      // Only Verdicts on other findings with this identity: earlier Reviews of the same code.
      if (current) setHistory(verdicts.find((v) => v.findingId !== finding.id) ?? null);
    });

    return () => {
      current = false;
    };
  }, [active, hostKey, finding.identity, finding.id]);

  return history;
};

const Card = ({ subjectKey, hostKey, summary, finding }: FindingItemProps) => {
  const history = useHistory(hostKey, finding, true);

  const verdict = (thumb: "up" | "down", draft: VerdictDraft | null) =>
    recordVerdict({
      hostKey,
      summaryId: summary.id,
      findingId: finding.id,
      thumb,
      reasons: draft?.reasons ?? [],
      text: draft?.text ?? null,
      scope: draft?.scope ?? "repo",
    });

  return (
    <div className="flex flex-col gap-2">
      {/* The hanging indent: the reason and its facts line up on the title's edge. */}
      <div className="gap-row-x flex">
        <span className="w-20 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {finding.reason !== "" && (
            <p className="text-caption text-text-subtle leading-[17px]">{finding.reason}</p>
          )}
          {finding.status === "dismissed" && finding.severity === "critical" && (
            <p className="text-caption text-text-subtle">
              Dismissed, but nothing hides a critical finding.
            </p>
          )}
          {history !== null && (
            <p className="text-caption text-text-subtle">{historyLine(history)}</p>
          )}
          <span
            className="text-text-default truncate font-mono text-[11px] leading-4"
            title={placeOf(finding)}
          >
            {placeOf(finding)}
          </span>
          {/* The thumbs share the provenance line, so the card never grows past the column. */}
          <div className="flex items-center gap-1.5">
            <span className="text-caption text-text-subtle min-w-0 truncate">
              {provenanceOf(finding)}
            </span>
            <span className="min-w-0 flex-1" />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Confirm: ${finding.title}`}
              data-testid="verdict-up"
              onClick={() => void verdict("up", null)}
            >
              <ThumbUpIcon size={14} />
            </Button>
            <ThumbDown title={finding.title} onSave={(draft) => verdict("down", draft)} />
          </div>
        </div>
      </div>
      {/* The actions span the card, so both fit on one line beside a scrollbar. */}
      <div className="flex items-center justify-end gap-1.5">
        <Button size="xs" variant="secondary" onClick={() => commentOn(subjectKey, finding)}>
          Comment on this
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setAskAbout(subjectKey, finding.id)}>
          Ask about this
        </Button>
      </div>
    </div>
  );
};

export const FindingItem = (props: FindingItemProps) => {
  const { finding, selected, subjectKey } = props;
  const dimmed = isDimmed(finding) && !selected;

  return (
    <div
      data-testid="risk-finding"
      data-finding={finding.id}
      data-selected={selected ? "" : undefined}
      className={cn(
        "rounded-row flex flex-col border",
        selected
          ? cn("bg-row-selected gap-row-x p-3", SEVERITY_BORDER[finding.severity])
          : "hover:bg-fill-hover border-transparent",
        // Dimmed once, here; the badge isn't dimmed again (rule/low-confidence-dims).
        dimmed && "opacity-(--opacity-dimmed)"
      )}
    >
      <button
        type="button"
        onClick={() => select(subjectKey, finding)}
        aria-expanded={selected}
        className={cn(
          "gap-row-x flex cursor-default items-start text-left",
          !selected && "py-row-x px-3"
        )}
      >
        <span className="flex w-20 shrink-0">
          <SeverityBadge severity={finding.severity} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              "text-body line-clamp-2",
              selected ? "text-text-strong font-medium" : "text-text-default"
            )}
          >
            {finding.title}
          </span>
          {!selected && (
            <span className="text-caption text-text-subtle truncate">
              {fileName(finding.path)} · {provenanceOf(finding)}
            </span>
          )}
        </span>
      </button>
      {selected && <Card {...props} />}
    </div>
  );
};
