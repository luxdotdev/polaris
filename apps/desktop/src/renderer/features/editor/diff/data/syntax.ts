/**
 * The syntax-aware diff of two texts, computed in a worker that ends after a quiet spell so
 * TypeScript's parser doesn't stay in memory. TS and JS are tokenized by the parser there;
 * other languages by the diff's highlighter (highlightTokens.ts); plain text not at all.
 */
import { type SyntaxPatch, tokenizerFor } from "@polaris/syntax-diff";
import {
  type HighlightPool,
  highlightLanguage,
  highlightTokens,
  MAX_HIGHLIGHT_LINES,
} from "./highlightTokens.ts";
import type { SyntaxReply, SyntaxRequest } from "./syntaxMessages.ts";
import SyntaxWorker from "./syntax.worker.ts?worker";

export type SyntaxEngine = "parser" | "highlighter";

/** How `path` gets its tokens; null when only the line diff applies. */
export const syntaxEngine = (path: string): SyntaxEngine | null => {
  if (tokenizerFor(path) !== null) return "parser";

  return highlightLanguage(path) === null ? null : "highlighter";
};

/** Why the line diff stands: no tokenizer, too long to highlight again, no tokens, too many changes. */
export type LineReason = "unsupported" | "too-long" | "no-tokens" | "too-complex" | "failed";

export type SyntaxResult =
  | ({ readonly kind: "ok"; readonly ms: number } & SyntaxPatch)
  | { readonly kind: "line"; readonly reason: LineReason };

/** The worker goes after this long without a diff; the next one starts it again. */
const IDLE_MS = 30_000;

let worker: Worker | null = null;

let idle: ReturnType<typeof setTimeout> | undefined;

let nextId = 0;

const waiting = new Map<number, (reply: SyntaxReply) => void>();

const stop = () => {
  worker?.terminate();
  worker = null;
};

const differ = () => {
  clearTimeout(idle);

  if (worker !== null) return worker;
  const created = new SyntaxWorker();

  created.addEventListener("message", (event: MessageEvent<SyntaxReply>) => {
    waiting.get(event.data.id)?.(event.data);
    waiting.delete(event.data.id);

    if (waiting.size === 0) idle = setTimeout(stop, IDLE_MS);
  });
  // A failed worker fails what waits on it; the next diff starts a fresh one.
  created.addEventListener("error", () => {
    for (const [id, reply] of waiting) reply({ id, kind: "failed", message: "the worker failed" });
    waiting.clear();
    stop();
  });
  worker = created;

  return created;
};

const ask = (request: Omit<SyntaxRequest, "id">) =>
  new Promise<SyntaxReply>((resolve) => {
    const id = nextId++;

    waiting.set(id, resolve);
    differ().postMessage({ ...request, id });
  });

const lineCount = (text: string) => text.split("\n").length;

const tokensFor = async (
  pool: HighlightPool | undefined,
  path: string,
  old: string,
  fresh: string
) => {
  if (pool === undefined) return null;

  const [a, b] = await Promise.all([
    highlightTokens(pool, path, old),
    highlightTokens(pool, path, fresh),
  ]);

  return a === null || b === null ? null : { old: a, fresh: b };
};

/** The syntax-aware patch from `old` to `fresh`, or why the line diff stands. */
export const syntaxPatch = async (
  pool: HighlightPool | undefined,
  path: string,
  old: string,
  fresh: string
): Promise<SyntaxResult> => {
  const engine = syntaxEngine(path);

  if (engine === null) return { kind: "line", reason: "unsupported" };

  if (engine === "highlighter" && Math.max(lineCount(old), lineCount(fresh)) > MAX_HIGHLIGHT_LINES)
    return { kind: "line", reason: "too-long" };

  const tokens = engine === "parser" ? null : await tokensFor(pool, path, old, fresh);

  if (engine === "highlighter" && tokens === null) return { kind: "line", reason: "no-tokens" };
  const reply = await ask({ path, old, fresh, tokens });

  return reply.kind === "ok" ? reply : { kind: "line", reason: reply.kind };
};
