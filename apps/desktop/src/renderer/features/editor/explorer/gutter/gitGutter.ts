/**
 * The git gutter (DESIGN.md, Editor → Git status): a 2px bar on lines changed
 * since HEAD (`git-modified`, or `diff-added` for new lines) and a small
 * `diff-removed` wedge where lines were deleted. The base is the file at HEAD
 * (`git.show`), fetched once per commit; the buffer is diffed as you type.
 */
import {
  type Extension,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { EditorView, gutter, GutterMarker, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { polaris } from "../../../bridge.ts";
import { explorerKey, explorerOf, subscribeExplorers } from "../data/store.ts";
import { type EditorFile, editorFile } from "../../index.ts";
import { type GutterMark, gutterMarks, linesOf } from "../model/lineDiff.ts";
import { isUnder, relative } from "../model/paths.ts";

/** Typing settles for this long before the buffer is diffed again. */
const SETTLE_MS = 120;

/** Past this the gutter stays empty: diffing a huge generated file isn't worth a frame. */
const MAX_LINES = 50_000;

class Bar extends GutterMarker {
  constructor(readonly kind: "added" | "modified") {
    super();
  }

  override eq(other: GutterMarker) {
    return other instanceof Bar && other.kind === this.kind;
  }

  override toDOM() {
    const el = document.createElement("div");

    el.className = `cm-gitBar cm-gitBar-${this.kind}`;

    return el;
  }
}

class Wedge extends GutterMarker {
  /** `end`: the deletion was after the last line, so the wedge sits at its foot. */
  constructor(readonly end: boolean) {
    super();
  }

  override eq(other: GutterMarker) {
    return other instanceof Wedge && other.end === this.end;
  }

  override toDOM() {
    const el = document.createElement("div");

    el.className = this.end ? "cm-gitWedge cm-gitWedge-end" : "cm-gitWedge";

    return el;
  }
}

const added = new Bar("added");

const modified = new Bar("modified");

const wedge = new Wedge(false);

const wedgeEnd = new Wedge(true);

/** Gutter markers by line, rebuilt from marks; mapped through edits until the next diff. */
const markersOf = (view: EditorView, marks: ReadonlyArray<GutterMark>): RangeSet<GutterMarker> => {
  const { doc } = view.state;
  const builder = new RangeSetBuilder<GutterMarker>();
  const at = (line: number) => doc.line(Math.min(Math.max(line, 1), doc.lines)).from;

  // A wedge and a bar can share a line; a RangeSetBuilder takes them in position order.
  const points = marks.flatMap((mark): Array<[number, GutterMarker]> => {
    if (mark.kind === "deleted") return [[at(mark.at), mark.at > doc.lines ? wedgeEnd : wedge]];
    const bar = mark.kind === "added" ? added : modified;

    return Array.from({ length: mark.to - mark.from + 1 }, (_, i): [number, GutterMarker] => [
      at(mark.from + i),
      bar,
    ]);
  });

  for (const [pos, marker] of points.sort((a, b) => a[0] - b[0])) builder.add(pos, pos, marker);

  return builder.finish();
};

const replaceMarkers = StateEffect.define<RangeSet<GutterMarker>>();

const shown = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(replaceMarkers)) return effect.value;
    }

    return value.map(tr.changes);
  },
});

/** The file at HEAD as lines; null when git has no base for it (outside a repo, binary). */
const bases = new Map<string, Promise<ReadonlyArray<string> | null>>();

const baseOf = (file: EditorFile, toplevel: string, head: string | null) => {
  const key = `${file.hostKey}\u0000${head ?? ""}\u0000${file.path}`;
  const known = bases.get(key);

  if (known !== undefined) return known;

  const fetched =
    head === null || !isUnder(file.path, toplevel)
      ? Promise.resolve<ReadonlyArray<string>>([])
      : polaris()
          .request("git.show", {
            hostKey: file.hostKey,
            cwd: toplevel,
            revision: head,
            path: relative(file.path, toplevel),
          })
          .then((result) => {
            if (!result.ok) return result.error.code === "NotFound" ? [] : null;

            return result.value.content.kind === "text" ? linesOf(result.value.content.text) : null;
          });

  // A handful of open files per commit; old commits' entries go with the app session.
  bases.set(key, fetched);

  return fetched;
};

const facts = (file: EditorFile) => {
  const git = explorerOf(explorerKey(file.hostKey, file.workspaceId)).git;

  return git === null || git === "none" ? null : git;
};

const gitPlugin = ViewPlugin.fromClass(
  class {
    base: ReadonlyArray<string> | null = null;
    head: string | null | undefined = undefined;
    settle: ReturnType<typeof setTimeout> | null = null;
    readonly unsubscribe: () => void;

    constructor(readonly view: EditorView) {
      this.unsubscribe = subscribeExplorers(() => this.follow());
      this.follow();
    }

    /** Fetches the base again when HEAD moves (a commit, a checkout). */
    follow() {
      const file = this.view.state.facet(editorFile);
      const git = file === null ? null : facts(file);

      if (file === null || git === null || git.head === this.head) return;
      this.head = git.head;
      void baseOf(file, git.toplevel, git.head).then((base) => {
        if (this.head !== git.head) return;
        this.base = base;
        this.diff();
      });
    }

    update(update: ViewUpdate) {
      if (!update.docChanged || this.base === null) return;

      if (this.settle !== null) clearTimeout(this.settle);
      this.settle = setTimeout(() => {
        this.settle = null;
        this.diff();
      }, SETTLE_MS);
    }

    diff() {
      const { doc } = this.view.state;

      const marks =
        this.base === null || doc.lines > MAX_LINES
          ? []
          : gutterMarks(this.base, linesOf(doc.toString()));

      this.view.dispatch({ effects: replaceMarkers.of(markersOf(this.view, marks)) });
    }

    destroy() {
      this.unsubscribe();

      if (this.settle !== null) clearTimeout(this.settle);
    }
  }
);

const theme = EditorView.baseTheme({
  // The editor sizes the column (2px before the line numbers); the wedge may overhang it.
  ".cm-gitGutter": { position: "relative", overflow: "visible" },
  ".cm-gitGutter .cm-gutterElement": { position: "relative", overflow: "visible" },
  ".cm-gitBar": { position: "absolute", left: "0", top: "0", bottom: "0", width: "2px" },
  ".cm-gitBar-modified": { background: "var(--color-git-modified)" },
  ".cm-gitBar-added": { background: "var(--color-diff-added)" },
  ".cm-gitWedge": {
    position: "absolute",
    left: "0",
    top: "-4px",
    width: "0",
    height: "0",
    borderTop: "4px solid transparent",
    borderBottom: "4px solid transparent",
    borderLeft: "5px solid var(--color-diff-removed)",
  },
  ".cm-gitWedge-end": { top: "auto", bottom: "-4px" },
});

/** The gutter for one tab's state (registered with the editor per file). */
export const gitGutter = (): ReadonlyArray<Extension> => [
  shown,
  gitPlugin,
  gutter({
    class: "cm-gitGutter",
    markers: (view) => view.state.field(shown),
  }),
  theme,
];
