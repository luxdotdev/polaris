/**
 * One side of a diff as read from the Host, and what the tab can show for the pair: the diff,
 * or a calm notice for binary files, files too large to diff, or sides that match.
 */

export type SideContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "binary"; readonly size: number }
  | { readonly kind: "too-large"; readonly size: number };

export const EMPTY: SideContent = { kind: "text", text: "" };

/** Past either, the tab says so instead of diffing: a diff this size isn't read line by line. */
export const MAX_DIFF_BYTES = 1_000_000;

export const MAX_DIFF_LINES = 20_000;

const decoder = () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const lineCount = (text: string) => {
  let lines = 1;

  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) lines++;

  return lines;
};

/** A read's content as a side: binary when it isn't UTF-8 or holds a NUL, like the editor. */
export const sideOf = (
  content:
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "bytes"; readonly bytes: Uint8Array },
  size: number
): SideContent => {
  if (size > MAX_DIFF_BYTES) return { kind: "too-large", size };

  let text: string | null;

  try {
    text = content.kind === "text" ? content.text : decoder().decode(content.bytes);
  } catch {
    text = null;
  }

  if (text === null || text.includes("\u0000")) return { kind: "binary", size };

  return lineCount(text) > MAX_DIFF_LINES ? { kind: "too-large", size } : { kind: "text", text };
};

export type Pair =
  | { readonly kind: "binary" }
  | { readonly kind: "too-large"; readonly size: number }
  | { readonly kind: "same" }
  | { readonly kind: "text"; readonly old: string; readonly new: string };

/** What a pair of sides shows; a binary side wins over a large one. */
export const pairOf = (old: SideContent, fresh: SideContent): Pair => {
  if (old.kind === "binary" || fresh.kind === "binary") return { kind: "binary" };

  if (old.kind === "too-large" || fresh.kind === "too-large")
    return {
      kind: "too-large",
      size: Math.max(
        old.kind === "too-large" ? old.size : 0,
        fresh.kind === "too-large" ? fresh.size : 0
      ),
    };

  return old.text === fresh.text
    ? { kind: "same" }
    : { kind: "text", old: old.text, new: fresh.text };
};

const UNITS = ["bytes", "KB", "MB", "GB"] as const;

/** "2.4 MB": a size for the notice. */
export const sizeLabel = (bytes: number) => {
  let value = bytes;
  let unit = 0;

  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }

  return unit === 0 ? `${value} ${UNITS[0]}` : `${value.toFixed(1)} ${UNITS[unit]}`;
};
