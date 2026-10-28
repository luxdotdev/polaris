/**
 * Home's sections as a virtualized list sees them, and which constellation rows are on screen:
 * only those follow their constellation feed for task counts.
 */
import type { Home, HomeRow } from "./home.ts";

export type SectionKind = "needs-you" | "working" | "recent";

export interface HomeSection {
  readonly kind: SectionKind;
  readonly label: string;
  /** Shown after the label; null for recent, which is capped. */
  readonly count: number | null;
  readonly data: ReadonlyArray<HomeRow>;
}

/** Needs you, working, recent, each only when it has rows. */
export const homeSections = (home: Home): ReadonlyArray<HomeSection> => {
  const { needsYou, working, recent } = home.sections;

  const all: ReadonlyArray<HomeSection> = [
    { kind: "needs-you", label: "Needs you", count: needsYou.length, data: needsYou },
    { kind: "working", label: "Working", count: working.length, data: working },
    { kind: "recent", label: "Recent", count: null, data: recent },
  ];

  return all.filter((section) => section.data.length > 0);
};

/** A row as the list reports its visibility; section headers come with no item. */
export interface SeenRow {
  readonly item?: HomeRow | null;
  readonly isViewable: boolean;
}

/** The keys of the constellation rows on screen now. */
export const constellationsOnScreen = (seen: ReadonlyArray<SeenRow>): ReadonlySet<string> =>
  new Set(
    seen.flatMap(({ item, isViewable }) =>
      isViewable && item?.kind === "constellation" ? [item.key] : []
    )
  );
