/**
 * Everything the diff and the file list show for a ready Review: which files are viewed
 * and open, Pierre's items with their annotations, the gutter marks, the header models,
 * and the actions behind the chevrons, checkboxes and Turn dividers.
 */
import type { AnnotationSide, DiffLineAnnotation, FileDiffMetadata } from "@pierre/diffs";
import { useEffect, useMemo, useState } from "react";
import type { PullFileView } from "../../../../shared/github.ts";
import { contentsLoader } from "../data/expand.ts";
import { parseOne, type ReviewDiff } from "../data/useReviewDiff.ts";
import { markLocal, markPull, pendingKey, useViewed } from "../data/viewedStore.ts";
import { type FindingInfo, findingsIn, lineMarks, severityByPath } from "../model/findings.ts";
import { layoutRows, type LayoutRow, type ReviewFile, rowSignature } from "../model/layout.ts";
import { itemKey, marksCss } from "../model/marks.ts";
import {
  type FileViewed,
  localViewed,
  progressOf,
  pullFileViewed,
  type RemoteViewed,
} from "../model/viewed.ts";
import type { ReviewAnnotation } from "../surface.ts";
import type { PaneItem, RowMeta } from "./DiffPane.tsx";
import { type HeaderModel, headerStore } from "./FileHeader.tsx";

type ReadyDiff = Extract<ReviewDiff, { readonly kind: "ready" }>;

/** A pull request's side of Viewed: GitHub's state per path and how to set it. */
export interface PullViewed {
  readonly pull: {
    readonly repo: { readonly owner: string; readonly name: string };
    readonly number: number;
  };
  readonly pullId: string;
  readonly files: ReadonlyArray<PullFileView>;
}

export interface ReviewModelInput {
  readonly subjectKey: string;
  readonly diff: ReadyDiff;
  readonly findings: ReadonlyArray<FindingInfo>;
  readonly annotations: ReadonlyArray<ReviewAnnotation>;
  /** Null for an Agent Session (Viewed is local). */
  readonly pullViewed: PullViewed | null;
}

const sideOf = (side: "new" | "old"): AnnotationSide =>
  side === "old" ? "deletions" : "additions";

const annotationsFor = (
  path: string,
  findings: ReadonlyArray<FindingInfo>,
  slots: ReadonlyArray<ReviewAnnotation>
): Array<DiffLineAnnotation<RowMeta>> => [
  ...findingsIn(findings, path).map((finding) => ({
    side: sideOf(finding.lines.side),
    lineNumber: finding.lines.end,
    metadata: { kind: "finding" as const, finding },
  })),
  ...slots.flatMap((annotation) =>
    annotation.path === path
      ? [
          {
            side: sideOf(annotation.side),
            lineNumber: annotation.line,
            metadata: { kind: "slot" as const, annotation },
          },
        ]
      : []
  ),
];

const annotationSignature = (annotations: ReadonlyArray<DiffLineAnnotation<RowMeta>>) =>
  annotations
    .map((a) => (a.metadata.kind === "finding" ? a.metadata.finding.id : a.metadata.annotation.id))
    .join(",");

/** Each file's Viewed state: GitHub's for a pull request, this window's for a session. */
const useViewedStateOf = (input: ReviewModelInput): ((file: ReviewFile) => FileViewed) => {
  const book = useViewed((s) => s.book);
  const pending = useViewed((s) => s.pending);
  const { pullViewed, subjectKey } = input;

  return useMemo(() => {
    if (pullViewed === null) {
      return (file: ReviewFile) => localViewed(book, subjectKey, file.key, file.fingerprint);
    }

    const remote = new Map<string, RemoteViewed>(pullViewed.files.map((f) => [f.path, f.viewed]));

    return (file: ReviewFile) =>
      pullFileViewed(
        remote.get(file.file.path),
        pending.get(pendingKey(pullViewed.pullId, file.file.path))
      );
  }, [book, pending, pullViewed, subjectKey]);
};

const headerOf = (
  row: LayoutRow,
  viewed: FileViewed,
  severity: HeaderModel["severity"]
): HeaderModel => ({
  path: row.file.file.path,
  oldPath: row.file.file.oldPath,
  status: row.file.file.status,
  additions: row.file.file.additions,
  deletions: row.file.file.deletions,
  binary: row.file.file.binary,
  collapsed: row.collapsed,
  viewed: viewed === "viewed",
  changed: viewed === "changed",
  severity,
  divider: row.divider,
  note: null,
});

export const useReviewModel = (input: ReviewModelInput) => {
  const { diff, findings, annotations, subjectKey, pullViewed } = input;
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [openedSections, setOpenedSections] = useState<ReadonlySet<string>>(new Set());
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReadonlyMap<string, FileDiffMetadata>>(new Map());
  const viewedStateOf = useViewedStateOf(input);

  const viewedOf = useMemo(
    () => (file: ReviewFile) => viewedStateOf(file) === "viewed",
    [viewedStateOf]
  );

  const files = useMemo(() => diff.sections.flatMap((s) => s.files), [diff.sections]);
  const byKey = useMemo(() => new Map(files.map((f) => [f.key, f])), [files]);

  const rows = useMemo(
    () =>
      layoutRows({
        sections: diff.sections,
        scale: diff.scale,
        viewed: viewedOf,
        toggled,
        openedSections,
        openFile,
      }),
    [diff.sections, diff.scale, viewedOf, toggled, openedSections, openFile]
  );

  useEffect(() => {
    const file = openFile === null ? undefined : byKey.get(openFile);
    const bytes = file === undefined ? undefined : diff.bytes.get(file.section);

    if (diff.scale !== "list-only" || file === undefined || bytes === undefined) return;

    if (opened.has(file.key)) return;

    void parseOne(bytes, file).then((parsed) => {
      if (parsed !== undefined) setOpened((m) => new Map(m).set(file.key, parsed));
    });
  }, [openFile, byKey, diff.bytes, diff.scale, opened]);

  const parsedAll = useMemo(
    () => (opened.size === 0 ? diff.parsed : new Map([...diff.parsed, ...opened])),
    [diff.parsed, opened]
  );

  const severities = useMemo(() => severityByPath(findings), [findings]);
  const css = useMemo(() => marksCss(lineMarks(findings, files)), [findings, files]);
  const itemKeys = useMemo(() => new Map(files.map((f) => [f.key, itemKey(f.index)])), [files]);

  const items = useMemo(
    () =>
      rows.flatMap((row): ReadonlyArray<PaneItem> => {
        const fileDiff = parsedAll.get(row.file.key);

        if (fileDiff === undefined) return [];

        const rowAnnotations = annotationsFor(row.file.file.path, findings, annotations);

        return [
          {
            path: row.file.file.path,
            item: {
              id: row.file.key,
              type: "diff",
              fileDiff,
              collapsed: row.collapsed,
              annotations: rowAnnotations,
            },
            signature: `${rowSignature(row, viewedOf(row.file))}|${annotationSignature(rowAnnotations)}`,
          },
        ];
      }),
    [rows, parsedAll, findings, annotations, viewedOf]
  );

  useEffect(() => {
    const models = Object.fromEntries(
      rows.map((row) => [
        row.file.key,
        headerOf(row, viewedStateOf(row.file), severities.get(row.file.file.path) ?? null),
      ])
    );

    headerStore.setState({ rows: models });
  }, [rows, viewedStateOf, severities]);

  const setViewed = (key: string, viewed: boolean) => {
    const file = byKey.get(key);

    if (file === undefined) return;

    setToggled((t) => new Map([...t].filter(([k]) => k !== key)));

    if (pullViewed === null) markLocal(subjectKey, file.key, viewed ? file.fingerprint : null);
    else
      void markPull(
        { pull: pullViewed.pull, pullId: pullViewed.pullId, path: file.file.path },
        viewed
      );
  };

  useEffect(() => {
    headerStore.setState({
      actions: {
        toggle: (key) => {
          const row = rows.find((r) => r.file.key === key);

          if (row !== undefined) setToggled((t) => new Map(t).set(key, row.collapsed));
        },
        setViewed,
        openSections: (ids) => setOpenedSections((s) => new Set([...s, ...ids])),
      },
    });
  });

  const parsedFiles = useMemo(() => {
    const map = new Map<FileDiffMetadata, ReviewFile>();

    for (const [key, parsed] of parsedAll) {
      const file = byKey.get(key);

      if (file !== undefined) map.set(parsed, file);
    }

    return map;
  }, [parsedAll, byKey]);

  const loadDiffFiles = useMemo(
    () => contentsLoader(diff.source, (parsed) => parsedFiles.get(parsed)),
    [diff.source, parsedFiles]
  );

  const viewedCount = files.filter(viewedOf).length;

  return {
    files,
    rows,
    items,
    marksCss: css,
    itemKeys,
    loadDiffFiles,
    severities,
    viewedOf,
    viewedStateOf,
    progress: progressOf(viewedCount, files.length),
    setViewed,
    openFile,
    /** Opens a file from the list: list-only Reviews show it alone; others expand it. */
    open: (key: string) => {
      setOpenFile(key);
      setToggled((t) => new Map(t).set(key, true));
    },
  };
};

export type ReviewModel = ReturnType<typeof useReviewModel>;
