/**
 * What the diff shows, as rows for Pierre's CodeView: one per file, grouped into sections
 * (an Agent Session's Turns, newest first, or its Intent Groups; a pull request is one
 * section with no divider). The first file of a section carries its divider in its header
 * (ENG-218 option a). Older Turns and reviewed ones fold, a run of them to one line
 * ("Turns 22–23"), until opened; an Intent Group folds alone, once reviewed.
 */
import type { IntentCategory } from "@polaris/protocol";
import type { PatchFile } from "./patch.ts";
import type { ReviewScale } from "./policy.ts";

export interface ReviewFile {
  /** Unique in the Review: the section and the path. */
  readonly key: string;
  /** Position in the Review; `itemKey(index)` scopes its gutter marks. */
  readonly index: number;
  readonly section: string;
  readonly file: PatchFile;
  readonly fingerprint: string;
  /** A lockfile or generated file (`noiseOf`): opens collapsed, outside Viewed progress. */
  readonly generated: boolean;
  /** A test file (`noiseOf`); never also generated. */
  readonly test: boolean;
}

export interface ReviewSection {
  readonly id: string;
  /** Null for a pull request: no divider. */
  readonly divider: SectionDivider | null;
  readonly files: ReadonlyArray<ReviewFile>;
}

export interface SectionDivider {
  /** The Turn's number (its index + 1). */
  readonly turn: number;
  /** Its Harness, for the divider's tile. */
  readonly harness: string;
  /** The Turn's prompt, quoted; null when there is none. An Intent Group's "why". */
  readonly quote: string | null;
  /** Set on an Intent Group's section ("By intent", Paper R11b). */
  readonly intent?: IntentDivider;
}

export interface IntentDivider {
  readonly label: string;
  readonly category: IntentCategory;
  readonly critical: boolean;
  /** The Turns its files come from, oldest first. */
  readonly turns: ReadonlyArray<number>;
}

/** One CodeView item. */
export interface LayoutRow {
  readonly file: ReviewFile;
  readonly collapsed: boolean;
  /** Set on the first file of a section with a divider. */
  readonly divider: DividerRow | null;
}

export interface DividerRow extends SectionDivider {
  /** "Turn 24", "Turns 22–23" for a folded run. */
  readonly label: string;
  /** The sections this row stands for: one, or a folded run. */
  readonly sectionIds: ReadonlyArray<string>;
  /** "2 files", "2 files · all viewed". */
  readonly caption: string;
  /** Folded: this row stands for its sections until opened. */
  readonly folded: boolean;
  /** Every file in its sections viewed: the folded row shows a check. */
  readonly reviewed: boolean;
}

export interface LayoutInput {
  readonly sections: ReadonlyArray<ReviewSection>;
  readonly scale: ReviewScale;
  readonly viewed: (file: ReviewFile) => boolean;
  /** Files the user opened (true) or closed (false), overriding the default. */
  readonly toggled: ReadonlyMap<string, boolean>;
  /** Folded sections the user opened again. */
  readonly openedSections: ReadonlySet<string>;
  /** List-only scale: the one file open, if any. */
  readonly openFile: string | null;
}

const filesCaption = (count: number, allViewed: boolean) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? "file" : "files"}${allViewed ? " · all viewed" : ""}`;

const defaultCollapsed = (input: LayoutInput, file: ReviewFile) =>
  input.scale !== "full" || input.viewed(file) || file.file.binary || file.generated;

const turnList = (turns: ReadonlyArray<number>) =>
  `${turns.length === 1 ? "Turn" : "Turns"} ${turns.join(", ")}`;

const turnsLabel = (turns: ReadonlyArray<number>) => {
  const low = Math.min(...turns);
  const high = Math.max(...turns);

  return low === high ? `Turn ${low}` : `Turns ${low}–${high}`;
};

/** A section's place in the layout: open with its files, or folded into a one-line row. */
interface Placed {
  readonly section: ReviewSection;
  readonly first: ReviewFile;
  readonly allViewed: boolean;
  readonly folded: boolean;
}

/** The newest Turn (first) stays open unless reviewed; older and reviewed Turns fold. */
const place = (input: LayoutInput): ReadonlyArray<Placed> =>
  input.sections.flatMap((section, index) => {
    const [first] = section.files;

    if (first === undefined) return [];

    // Generated files don't hold a Turn open: they sit outside Viewed progress.
    const allViewed = section.files.filter((f) => !f.generated).every(input.viewed);

    const foldable =
      section.divider !== null &&
      (allViewed || (index > 0 && section.divider.intent === undefined));

    return [
      { section, first, allViewed, folded: foldable && !input.openedSections.has(section.id) },
    ];
  });

const dividerOf = (run: ReadonlyArray<Placed>, folded: boolean): DividerRow | null => {
  const [head] = run;
  const divider = head?.section.divider;

  if (head === undefined || divider === undefined || divider === null) return null;

  const allViewed = run.every((p) => p.allViewed);
  const turns = run.map((p) => p.section.divider?.turn ?? 0);

  const files = filesCaption(
    run.reduce((n, p) => n + p.section.files.length, 0),
    allViewed
  );

  if (divider.intent !== undefined) {
    // A group of generated files folds like them and stays outside Viewed.
    const generated = head.section.files.every((f) => f.generated);
    const count = head.section.files.length.toLocaleString("en-US");

    return {
      ...divider,
      label: divider.intent.label,
      sectionIds: [head.section.id],
      caption: `${turnList(divider.intent.turns)} · ${generated ? `${count} generated` : files}`,
      folded,
      reviewed: allViewed && !generated,
    };
  }

  return {
    ...divider,
    label: turnsLabel(turns),
    // A folded run quotes its newest Turn (sections come newest first).
    quote: divider.quote,
    sectionIds: run.map((p) => p.section.id),
    caption: files,
    folded,
    reviewed: allViewed,
  };
};

const openRows = (input: LayoutInput, placed: Placed): ReadonlyArray<LayoutRow> =>
  placed.section.files.map((file) => ({
    file,
    collapsed: !(input.toggled.get(file.key) ?? !defaultCollapsed(input, file)),
    divider: file === placed.first ? dividerOf([placed], false) : null,
  }));

export const layoutRows = (input: LayoutInput): ReadonlyArray<LayoutRow> => {
  if (input.scale === "list-only") {
    const file = input.sections.flatMap((s) => s.files).find((f) => f.key === input.openFile);

    return file === undefined ? [] : [{ file, collapsed: false, divider: null }];
  }

  const rows: Array<LayoutRow> = [];
  let run: Array<Placed> = [];

  const flush = () => {
    const [head] = run;

    if (head !== undefined)
      rows.push({ file: head.first, collapsed: true, divider: dividerOf(run, true) });

    run = [];
  };

  for (const placed of place(input)) {
    if (placed.folded) {
      // An Intent Group folds to its own row; consecutive Turns share one.
      if (placed.section.divider?.intent !== undefined) flush();
      run.push(placed);
      continue;
    }

    flush();
    rows.push(...openRows(input, placed));
  }

  flush();

  return rows;
};

/** A row's identity for CodeView's `version` bump: what its rendering depends on. */
export const rowSignature = (row: LayoutRow, viewed: boolean) =>
  [
    row.collapsed ? "c" : "o",
    viewed ? "v" : "-",
    row.divider === null
      ? ""
      : `${row.divider.folded ? "f" : "d"}${row.divider.label}${row.divider.caption}`,
  ].join("|");
