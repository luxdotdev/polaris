import { PredictionError, type EditPredictionRequest } from "@polaris/protocol";
import { sweepOptions, type SweepOptions } from "./options.ts";

export interface EditWindow {
  readonly lines: readonly string[];
  readonly offsets: readonly number[];
  readonly bounds: readonly number[];
  readonly from: number;
  readonly to: number;
  readonly focusLine: number;
  readonly eol: string;
}

export const lineAt = (buffer: string, offset: number) =>
  buffer.slice(0, offset).split("\n").length - 1;

export const editWindow = (
  request: EditPredictionRequest,
  options: SweepOptions = sweepOptions
): EditWindow => {
  const focus = request.focus ?? request.cursor;

  if (focus > request.buffer.length || request.cursor > request.buffer.length)
    throw new PredictionError({
      reason: "invalid-request",
      message: "Cursor or focus is outside the buffer",
    });
  const lines = request.buffer.split("\n");
  const offsets = [0];

  for (const line of lines)
    offsets.push(Math.min(request.buffer.length, (offsets.at(-1) ?? 0) + line.length + 1));
  const k = lineAt(request.buffer, focus);

  const bounds =
    request.format === "zeta-2.1"
      ? [Math.max(0, k - 13), Math.min(lines.length, k + 3), Math.min(lines.length, k + 16)]
      : [Math.max(0, k - options.above), Math.min(lines.length, k + options.below + 1)];

  const unique = [...new Set(bounds)];

  return {
    lines: lines.map((line) => line.replace(/\r$/, "")),
    offsets,
    bounds: unique,
    from: offsets[unique[0] ?? 0] ?? 0,
    to: offsets[unique.at(-1) ?? lines.length] ?? request.buffer.length,
    focusLine: k,
    eol: request.buffer.includes("\r\n") ? "\r\n" : "\n",
  };
};
