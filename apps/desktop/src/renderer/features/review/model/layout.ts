/**
 * What the diff shows, as rows for Pierre's CodeView: one per file, grouped into sections
 * (an Agent Session's Turns; a pull request is one section with no divider). The first
 * file of a section carries its divider in its header (ENG-218 option a); a reviewed Turn
 * (every file viewed) folds to that one line with a check until it is opened again.
 */
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
}

export interface ReviewSection {
  readonly id: string;
  /** Null for a pull request: no divider. */
  readonly divider: SectionDivider | null;
  readonly files: ReadonlyArray<ReviewFile>;
}

export interface SectionDivider {
  /** "Turn 24", "Turns 22–23". */
  readonly label: string;
  /** The Turn's prompt, quoted; null when there is none. */
  readonly quote: string | null;
}

/** One CodeView item. */
export interface LayoutRow {
  readonly file: ReviewFile;
  readonly collapsed: boolean;
  /** Set on the first file of a section with a divider. */
  readonly divider: DividerRow | null;
}

export interface DividerRow extends SectionDivider {
  readonly sectionId: string;
  /** "2 files", "2 files · all viewed". */
  readonly caption: string;
  /** Every file viewed and the section not opened again: this row stands for it. */
  readonly folded: boolean;
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
  input.scale !== "full" || input.viewed(file) || file.file.binary;

const sectionRows = (input: LayoutInput, section: ReviewSection): ReadonlyArray<LayoutRow> => {
  const [first] = section.files;

  if (first === undefined) return [];

  const allViewed = section.files.every(input.viewed);
  const folded = section.divider !== null && allViewed && !input.openedSections.has(section.id);

  const divider = (file: ReviewFile): DividerRow | null =>
    section.divider === null || file !== first
      ? null
      : {
          ...section.divider,
          sectionId: section.id,
          caption: filesCaption(section.files.length, allViewed),
          folded,
        };

  if (folded) return [{ file: first, collapsed: true, divider: divider(first) }];

  return section.files.map((file) => ({
    file,
    collapsed: !(input.toggled.get(file.key) ?? !defaultCollapsed(input, file)),
    divider: divider(file),
  }));
};

export const layoutRows = (input: LayoutInput): ReadonlyArray<LayoutRow> => {
  if (input.scale === "list-only") {
    const file = input.sections.flatMap((s) => s.files).find((f) => f.key === input.openFile);

    return file === undefined ? [] : [{ file, collapsed: false, divider: null }];
  }

  return input.sections.flatMap((section) => sectionRows(input, section));
};

/** A row's identity for CodeView's `version` bump: what its rendering depends on. */
export const rowSignature = (row: LayoutRow, viewed: boolean) =>
  [
    row.collapsed ? "c" : "o",
    viewed ? "v" : "-",
    row.divider === null ? "" : `${row.divider.folded ? "f" : "d"}${row.divider.caption}`,
  ].join("|");
