/**
 * Syntax-aware diffs off the main thread. TypeScript's parser (about 3 MB) loads here on the
 * first diff that needs it, never in the window; other languages arrive with their tokens.
 */
import {
  fixedTokenizer,
  syntaxDiff,
  type Tokenizer,
  tokenizerFor,
  TooComplex,
} from "@polaris/syntax-diff";
import type { SyntaxReply, SyntaxRequest } from "./syntaxMessages.ts";

const loaded = new Map<string, Promise<Tokenizer>>();

const parser = (path: string) => {
  const spec = tokenizerFor(path);

  if (spec === null) return null;
  const known = loaded.get(spec.id) ?? spec.load();

  loaded.set(spec.id, known);

  return known;
};

const tokenizerOf = (request: SyntaxRequest): Promise<Tokenizer> | null =>
  request.tokens === null
    ? parser(request.path)
    : Promise.resolve(
        fixedTokenizer("highlighter", [
          [request.old, request.tokens.old],
          [request.fresh, request.tokens.fresh],
        ])
      );

const answer = async (request: SyntaxRequest): Promise<SyntaxReply> => {
  const { id, path, old, fresh } = request;
  const load = tokenizerOf(request);

  if (load === null) return { id, kind: "unsupported" };

  try {
    const tokenizer = await load;
    const started = performance.now();
    const result = syntaxDiff(old, fresh, path, tokenizer);

    return { id, kind: "ok", ...result, ms: performance.now() - started };
  } catch (cause) {
    if (cause instanceof TooComplex) return { id, kind: "too-complex" };

    return { id, kind: "failed", message: cause instanceof Error ? cause.message : String(cause) };
  }
};

self.addEventListener("message", (event: MessageEvent<SyntaxRequest>) => {
  void answer(event.data).then((reply) => self.postMessage(reply));
});
