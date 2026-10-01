/**
 * Links out of Overview into the Review: a path opens in Changes at its line, a finding
 * chip selects the finding (the diff scrolls to it and Changes opens).
 */
import { cn, SeverityGlyph } from "@polaris/ui";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { revealInDiff, surfaceOf, surfaceStore, updateSurface } from "../../surface.ts";
import type { ReviewLink } from "../model/markdown.ts";

const TINT = {
  critical: "bg-[color-mix(in_oklab,var(--color-severity-critical)_12%,transparent)]",
  high: "bg-[color-mix(in_oklab,var(--color-severity-high)_12%,transparent)]",
  medium: "bg-[color-mix(in_oklab,var(--color-severity-medium)_12%,transparent)]",
  low: "bg-[color-mix(in_oklab,var(--color-severity-low)_12%,transparent)]",
} as const;

/** Selects the finding and scrolls the diff to it; revealing switches the pane to Changes. */
export const openFinding = (subjectKey: string, id: string) => {
  const finding = surfaceOf(subjectKey).findings.find((f) => f.id === id);

  if (finding === undefined) return;
  updateSurface(subjectKey, { selectedFinding: finding.id });
  revealInDiff(finding.path, finding.lines.end, finding.lines.side);
};

export const openPath = (path: string, line: number | null) => revealInDiff(path, line ?? 1);

/** "● Stop isn't audited when a session expires →", or the link's own text if it's gone. */
export const FindingChip = ({
  subjectKey,
  id,
  children,
}: {
  readonly subjectKey: string;
  readonly id: string;
  readonly children: ReactNode;
}) => {
  const finding = useStore(surfaceStore, (s) => s[subjectKey]?.findings.find((f) => f.id === id));

  if (finding === undefined) return <span className="text-text-default">{children}</span>;

  return (
    <button
      type="button"
      data-testid="walkthrough-finding"
      onClick={() => openFinding(subjectKey, id)}
      className={cn(
        "rounded-control px-gap text-caption hover:text-text-strong my-0.5 inline-flex h-[22px] cursor-default items-center gap-1.5 align-middle",
        TINT[finding.severity]
      )}
    >
      <SeverityGlyph severity={finding.severity} tone="text" />
      <span className="text-text-default">{finding.title}</span>
      <span className="text-text-subtle">→</span>
    </button>
  );
};

export const PathLink = ({
  path,
  line,
  children,
}: {
  readonly path: string;
  readonly line: number | null;
  readonly children: ReactNode;
}) => (
  <button
    type="button"
    data-testid="walkthrough-path"
    title={`Open ${line === null ? path : `${path}:${line}`} in Changes`}
    onClick={() => openPath(path, line)}
    className="md-path cursor-default text-left"
  >
    {children}
  </button>
);

/** `renderLink` for Review Markdown in one Review. */
export const reviewLinks =
  (subjectKey: string) =>
  (link: ReviewLink, children: ReactNode): ReactNode => {
    if (link.kind === "finding") {
      return (
        <FindingChip subjectKey={subjectKey} id={link.id}>
          {children}
        </FindingChip>
      );
    }

    if (link.kind === "path") {
      return (
        <PathLink path={link.path} line={link.line}>
          {children}
        </PathLink>
      );
    }

    return children;
  };
