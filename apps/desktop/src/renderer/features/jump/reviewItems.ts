/**
 * What the jump menu reaches in Review (Paper R1: "Jump to a PR, file, or finding"): every
 * pull request in the list, the open Review's files, and its Risk Findings, most severe first.
 */
import type { OpenPull } from "../../../shared/api.ts";
import type { PullListView, PullRowView } from "../../../shared/github.ts";
import { repoOfRow } from "../../../shared/github.ts";
import type { JumpItem } from "./items.ts";

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;

const SEVERITY_WORDS = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
} as const;

type Severity = keyof typeof SEVERITY_ORDER;

/** What the menu needs of a Risk Finding (protocol `RiskFinding`). */
export interface JumpFinding {
  readonly id: string;
  readonly path: string;
  readonly lines: { readonly start: number; readonly side: "new" | "old" };
  readonly severity: Severity;
  readonly title: string;
  readonly status: string;
}

const base = { state: null, harness: null, needsYou: false } as const;

const pullItem = (row: PullRowView): JumpItem => {
  const repo = repoOfRow(row);
  const pull: OpenPull = { repo, number: row.number, pullId: row.id };

  return {
    ...base,
    id: `pull:${row.id}`,
    title: row.title,
    keywords: [
      `#${row.number}`,
      `${repo.owner}/${repo.name}`,
      row.author?.login ?? "",
      row.headRefName,
    ],
    target: { kind: "pull", pull },
    detail: `#${row.number} · ${repo.owner}/${repo.name}`,
    meta: row.author?.login ?? "",
  };
};

export const pullItems = (list: PullListView | null): ReadonlyArray<JumpItem> => {
  const rows = [...(list?.requested ?? []), ...(list?.mine ?? []), ...(list?.other ?? [])];
  const seen = new Set<string>();

  return rows.flatMap((row) => {
    if (seen.has(row.id)) return [];

    seen.add(row.id);

    return [pullItem(row)];
  });
};

/** The open Review's files, each once (a session's Turns can touch a file twice). */
export const fileItems = (paths: ReadonlyArray<string>): ReadonlyArray<JumpItem> =>
  [...new Set(paths)].map((path) => {
    const slash = path.lastIndexOf("/");

    return {
      ...base,
      id: `file:${path}`,
      title: path.slice(slash + 1),
      keywords: [path],
      target: { kind: "file", path },
      detail: slash === -1 ? "" : path.slice(0, slash),
      meta: "",
    };
  });

/** Open findings, and a dismissed Critical (nothing hides one), most severe first. */
export const findingItems = (findings: ReadonlyArray<JumpFinding>): ReadonlyArray<JumpItem> =>
  findings
    .filter((f) => f.status === "open" || (f.status === "dismissed" && f.severity === "critical"))
    .toSorted((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .map((finding) => ({
      ...base,
      id: `finding:${finding.id}`,
      title: finding.title,
      keywords: [finding.path, SEVERITY_WORDS[finding.severity]],
      target: {
        kind: "finding",
        findingId: finding.id,
        path: finding.path,
        line: finding.lines.start,
        side: finding.lines.side,
      },
      detail: `${finding.path}:${finding.lines.start}`,
      meta: SEVERITY_WORDS[finding.severity],
    }));
