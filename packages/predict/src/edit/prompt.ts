import type { EditHistoryHunk, EditPredictionRequest } from "@polaris/protocol";
import type { PredictionPrompt } from "../prompt.ts";
import { historyBlocks, linesOf } from "./history.ts";
import { sweepOptions, type SweepOptions } from "./options.ts";
import { editWindow, lineAt, type EditWindow } from "./window.ts";

const unified = (hunk: EditHistoryHunk) => {
  const before = linesOf(hunk.before),
    after = linesOf(hunk.after);

  return [
    `--- a/${hunk.path}`,
    `+++ b/${hunk.path}`,
    `@@ -${hunk.line + 1},${before.length} +${hunk.line + 1},${after.length} @@`,
    ...before.map((line) => `-${line}`),
    ...after.map((line) => `+${line}`),
  ].join("\n");
};

const zeta = (request: EditPredictionRequest, window: EditWindow): PredictionPrompt => {
  const lines = [...window.lines];
  const cursorLine = lineAt(request.buffer, request.cursor);
  const col = request.cursor - (window.offsets[cursorLine] ?? 0);
  const line = lines[cursorLine] ?? "";
  lines[cursorLine] = `${line.slice(0, col)}<|user_cursor|>${line.slice(col)}`;
  const [lo = 0, mid = lines.length, hi = mid] = window.bounds;
  const before = lines.slice(Math.max(0, lo - 40), lo).join("\n");

  const region =
    `<|marker_1|>${lines.slice(lo, mid).join("\n")}\n<|marker_2|>` +
    (hi > mid ? `${lines.slice(mid, hi).join("\n")}<|marker_3|>` : "");

  return {
    prompt: `<[fim-suffix]>\n<[fim-prefix]><filename>edit_history\n${request.history.map(unified).join("\n")}\n\n<filename>${request.path}\n${before ? `${before}\n` : ""}${region}\n<[fim-middle]>`,
    stop: ["<[end▁of▁sentence]>", "<[fim-"],
  };
};

const previousWindow = (request: EditPredictionRequest, window: EditWindow) => {
  const [lo = 0, hi = window.lines.length] = window.bounds;
  const hunk = request.history.filter((h) => h.path === request.path).at(-1);

  if (!hunk) return window.lines.slice(lo, hi).join("\n");

  const after = linesOf(hunk.after),
    before = linesOf(hunk.before);

  // A frozen history snapshot may no longer match the live buffer.
  if (window.lines.slice(hunk.line, hunk.line + after.length).join("\n") !== after.join("\n"))
    return window.lines.slice(lo, hi).join("\n");
  const previous = [...window.lines];
  previous.splice(hunk.line, after.length, ...before);
  const shift = before.length - after.length;
  const map = (at: number) => (at <= hunk.line ? at : Math.max(hunk.line, at + shift));

  return previous.slice(map(lo), map(hi)).join("\n");
};

const sweep = (
  request: EditPredictionRequest,
  window: EditWindow,
  options: SweepOptions
): PredictionPrompt => {
  const [lo = 0, hi = window.lines.length] = window.bounds;

  const parts = [
    `<|file_sep|>${request.path}`,
    window.lines.slice(Math.max(0, window.focusLine - options.prefixLines), lo).join("\n"),
  ];

  for (const hunk of historyBlocks(request, window.lines, options))
    parts.push(`<|file_sep|>${hunk.path}.diff`, "original:", hunk.before, "updated:", hunk.after);
  parts.push(
    `<|file_sep|>original/${request.path}`,
    previousWindow(request, window),
    `<|file_sep|>current/${request.path}`,
    window.lines.slice(lo, hi).join("\n"),
    `<|file_sep|>updated/${request.path}`
  );

  return { prompt: parts.join("\n"), stop: ["<|file_sep|>", "</s>", "<|endoftext|>"] };
};

export const buildEditPrompt = (
  request: EditPredictionRequest,
  options: SweepOptions = sweepOptions
) => {
  const window = editWindow(request, options);

  return {
    window,
    ...(request.format === "zeta-2.1" ? zeta(request, window) : sweep(request, window, options)),
  };
};
