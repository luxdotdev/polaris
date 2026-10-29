/**
 * Home's sections under the needs you hero (MX-C) as a virtualized list sees them, and which
 * constellation rows are on screen: only those follow their constellation feed for task counts.
 */
import type { Home, HomeRow } from "./home.ts";

export type SectionKind = "working" | "recent";

export interface HomeSection {
  readonly kind: SectionKind;
  /** The section's mono kicker: "Working · 3", or "Recent", which is capped. */
  readonly label: string;
  readonly data: ReadonlyArray<HomeRow>;
}

/** Working, recent, each only when it has rows; needs you is the hero above them. */
export const homeSections = (home: Home): ReadonlyArray<HomeSection> => {
  const { working, recent } = home.sections;

  const all: ReadonlyArray<HomeSection> = [
    { kind: "working", label: `Working · ${working.length}`, data: working },
    { kind: "recent", label: "Recent", data: recent },
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
