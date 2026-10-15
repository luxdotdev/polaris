import type { EditHistoryHunk, EditPredictionRequest } from "@polaris/protocol";
import type { SweepOptions } from "./options.ts";

export const linesOf = (text: string) => (text ? text.replace(/\r\n/g, "\n").split("\n") : []);

interface Block {
  readonly path: string;
  readonly before: string;
  readonly after: string;
}

/** Undoes the buffer's own hunks newest first, so each hunk gets the context lines of its time. */
const withContext = (
  request: EditPredictionRequest,
  lines: readonly string[],
  hunks: readonly EditHistoryHunk[],
  context: number
): Block[] => {
  const state = [...lines];
  let live = true;
  const blocks: Block[] = [];

  for (const hunk of hunks.toReversed()) {
    const before = linesOf(hunk.before),
      after = linesOf(hunk.after);

    if (hunk.path !== request.path) {
      blocks.push(hunk);
      continue;
    }

    // A frozen snapshot that no longer matches the buffer gets no context from here on.
    live &&= state.slice(hunk.line, hunk.line + after.length).join("\n") === after.join("\n");

    if (!live) {
      blocks.push(hunk);
      continue;
    }

    const lead = state.slice(Math.max(0, hunk.line - context), hunk.line);
    const trail = state.slice(hunk.line + after.length, hunk.line + after.length + context);
    blocks.push({
      path: hunk.path,
      before: [...lead, ...before, ...trail].join("\n"),
      after: [...lead, ...after, ...trail].join("\n"),
    });
    state.splice(hunk.line, after.length, ...before);
  }

  return blocks.toReversed();
};

/** The `.diff` blocks of the Sweep prompt, oldest first. */
export const historyBlocks = (
  request: EditPredictionRequest,
  lines: readonly string[],
  options: SweepOptions
) => {
  const blocks = withContext(request, lines, request.history, options.historyContext);
  const last = request.history.findLastIndex((hunk) => hunk.path === request.path);
  const kept = options.lastAsDiff ? blocks : blocks.filter((_, i) => i !== last);

  return kept.slice(Math.max(0, kept.length - options.historyLimit));
};
