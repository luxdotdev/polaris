/** The composer's labels and the GitHub suggestion block "Suggest change" inserts. */
import type { ComposerAnchor } from "../data/store.ts";

/** "Lines 38–39", "Line 41", with "(removed)" for the old side. */
export const anchorLabel = (anchor: Pick<ComposerAnchor, "start" | "end" | "side">) => {
  const lines =
    anchor.start === anchor.end ? `Line ${anchor.start}` : `Lines ${anchor.start}–${anchor.end}`;

  return anchor.side === "old" ? `${lines} (removed)` : lines;
};

/** A fence longer than any backtick run in `code`, so the block can't close early. */
const fence = (code: string) =>
  "`".repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((run) => run[0].length + 1)));

/** GitHub's suggested-change block, starting from the selected code. */
export const suggestionBlock = (code: string) => {
  const marker = fence(code);

  return `${marker}suggestion\n${code}\n${marker}`;
};

/** "serve.ts:4", "index.html:410–412": an Agent Session comment's place (Paper R8). */
export const placeLabel = (anchor: Pick<ComposerAnchor, "path" | "start" | "end">) => {
  const name = anchor.path.slice(anchor.path.lastIndexOf("/") + 1);

  return anchor.start === anchor.end
    ? `${name}:${anchor.start}`
    : `${name}:${anchor.start}–${anchor.end}`;
};
