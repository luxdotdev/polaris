/**
 * Moving the palette's highlight: ↑↓ one row (wrapping), Tab and ⇧Tab to the
 * first row of the next or previous group (wrapping). The highlight is a row's
 * id, so it survives the list changing under it.
 */
export interface Section {
  readonly items: ReadonlyArray<{ readonly id: string }>;
}

const ids = (sections: ReadonlyArray<Section>) => sections.flatMap((s) => s.items.map((i) => i.id));

const wrap = (at: number, length: number) => ((at % length) + length) % length;

/** The highlighted id, or the first row's when it is gone. */
export const highlighted = (sections: ReadonlyArray<Section>, current: string | null) => {
  const all = ids(sections);

  return current !== null && all.includes(current) ? current : (all[0] ?? null);
};

export const stepRow = (
  sections: ReadonlyArray<Section>,
  current: string | null,
  delta: number
): string | null => {
  const all = ids(sections);

  if (all.length === 0) return null;
  const at = all.indexOf(highlighted(sections, current) ?? "");

  return all[wrap(at + delta, all.length)] ?? null;
};

export const stepGroup = (
  sections: ReadonlyArray<Section>,
  current: string | null,
  delta: number
): string | null => {
  const filled = sections.filter((s) => s.items.length > 0);

  if (filled.length === 0) return null;
  const now = highlighted(filled, current);
  const at = filled.findIndex((s) => s.items.some((i) => i.id === now));

  return filled[wrap(at + delta, filled.length)]?.items[0]?.id ?? null;
};
