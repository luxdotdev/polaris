import { PredictionError, type EditPredictionRequest } from "@polaris/protocol";
import type { EditWindow } from "./window.ts";

export interface Region {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly cursor: number | null;
}

const invalid = () =>
  new PredictionError({ reason: "invalid-response", message: "Malformed edit prediction region" });

const region = (window: EditWindow, from: number, to: number, output: string): Region => {
  const marker = "<|user_cursor|>";
  const cursor = output.indexOf(marker);

  if (cursor >= 0 && output.indexOf(marker, cursor + marker.length) >= 0) throw invalid();
  const clean = output.replace(marker, "").replace(/\r\n/g, "\n");
  const body = clean.endsWith("\n") ? clean.slice(0, -1) : clean;
  const start = window.offsets[from] ?? window.from;
  const end = window.offsets[to] ?? window.to;

  const text =
    body.replace(/\n/g, window.eol) + (body && to < window.lines.length ? window.eol : "");

  const position =
    cursor < 0
      ? null
      : output.slice(0, cursor).replace(/\r\n/g, "\n").replace(/\n/g, window.eol).length;

  return {
    from: start,
    to: end,
    text,
    cursor: position === null ? null : Math.min(position, text.length),
  };
};

const zetaRegions = (window: EditWindow, output: string) => {
  const tokens = [...output.matchAll(/<\|marker_(\d+)\|>/g)];

  if (tokens.length < 2 || output.slice(0, tokens[0]?.index).trim()) throw invalid();
  const regions: Region[] = [];
  let outside = false;
  let previous = 0;

  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i],
      next = tokens[i + 1];

    if (!token || !next) throw invalid();

    const a = Number(token[1]),
      b = Number(next[1]);

    const body = output.slice(token.index + token[0].length, next.index);

    if (a === b && !body.trim()) continue;

    if (b !== a + 1 || a < 1 || b > window.bounds.length) {
      outside = true;
      continue;
    }

    if (a <= previous) throw invalid();
    previous = a;
    regions.push(region(window, window.bounds[a - 1] ?? 0, window.bounds[b - 1] ?? 0, body));
  }

  const last = tokens.at(-1);

  if (last && output.slice(last.index + last[0].length).trim()) throw invalid();

  return { regions, outside };
};

export const parseRegions = (
  request: EditPredictionRequest,
  window: EditWindow,
  raw: string,
  stops: readonly string[]
) => {
  let output = raw;

  for (const stop of stops) {
    const at = output.indexOf(stop);

    if (at >= 0) output = output.slice(0, at);
  }

  if (!output.trim()) return { regions: [], outside: false };

  if (request.format === "zeta-2.1") return zetaRegions(window, output.trim());

  return {
    regions: [
      region(
        window,
        window.bounds[0] ?? 0,
        window.bounds[1] ?? window.lines.length,
        output.replace(/^\r?\n/, "")
      ),
    ],
    outside: false,
  };
};
