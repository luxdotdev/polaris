/**
 * Risk Findings in the diff: which lines they flag (gutter marks), each file's highest
 * Severity (its header badge and the file list's glyph), and the reason row under each
 * flagged line. A dismissed or resolved finding drops out, except a Critical one, which
 * nothing hides (DESIGN.md, Review).
 */
import type { ReviewFile } from "./layout.ts";
import { itemKey, type LineMark, type MarkSeverity, SEVERITY_ORDER } from "./marks.ts";

/** The fields of a protocol `RiskFinding` the diff uses. */
export interface FindingInfo {
  readonly id: string;
  readonly path: string;
  readonly lines: { readonly start: number; readonly end: number; readonly side: "new" | "old" };
  readonly severity: MarkSeverity;
  readonly confidence: number;
  readonly title: string;
  readonly reason: string;
  readonly status: "open" | "dismissed" | "resolved";
}

export const isShown = (finding: FindingInfo) =>
  finding.status === "open" || finding.severity === "critical";

/** Non-Critical findings under 50% confidence are dimmed (ENG-185). */
export const isDimmed = (finding: FindingInfo) =>
  finding.severity !== "critical" && finding.confidence < 0.5;

const byPath = (findings: ReadonlyArray<FindingInfo>) => {
  const map = new Map<string, Array<FindingInfo>>();

  for (const finding of findings.filter(isShown)) {
    const list = map.get(finding.path) ?? [];

    list.push(finding);
    map.set(finding.path, list);
  }

  return map;
};

export const lineMarks = (
  findings: ReadonlyArray<FindingInfo>,
  files: ReadonlyArray<ReviewFile>
): ReadonlyArray<LineMark> => {
  const flagged = byPath(findings);

  return files.flatMap((file) =>
    (flagged.get(file.file.path) ?? []).map((finding): LineMark => ({
      item: itemKey(file.index),
      side: finding.lines.side,
      start: finding.lines.start,
      end: finding.lines.end,
      severity: finding.severity,
    }))
  );
};

/** Each path's most severe shown finding. */
export const severityByPath = (
  findings: ReadonlyArray<FindingInfo>
): ReadonlyMap<string, MarkSeverity> => {
  const map = new Map<string, MarkSeverity>();

  for (const finding of findings.filter(isShown)) {
    const held = map.get(finding.path);

    if (held === undefined || SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[held]) {
      map.set(finding.path, finding.severity);
    }
  }

  return map;
};

/** The findings whose reason row sits in this file, most severe first. */
export const findingsIn = (findings: ReadonlyArray<FindingInfo>, path: string) =>
  (byPath(findings).get(path) ?? []).toSorted(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.confidence - a.confidence
  );

/** A queue row's mark: the highest shown Severity and how many findings have it. */
export interface RiskMark {
  readonly severity: MarkSeverity;
  readonly count: number;
}

export const riskMark = (findings: ReadonlyArray<FindingInfo>): RiskMark | null => {
  const shown = findings.filter(isShown);
  const [top] = shown.toSorted((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  if (top === undefined) return null;

  return { severity: top.severity, count: shown.filter((f) => f.severity === top.severity).length };
};
