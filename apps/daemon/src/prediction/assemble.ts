import { budgetContext } from "./budget.ts";
import { PredictionContextPiece } from "@polaris/protocol";
import type {
  LanguageConnectionIdentity,
  PredictionContext,
  PredictionContextRequest,
} from "@polaris/protocol";
import { resolve } from "node:path";
import { within } from "../languages/trust/checkout.ts";
import { OutlineCache, importedSources, sourceName } from "./files.ts";
import { languagePieces, type LanguageSource } from "./language.ts";

interface Snapshot {
  at: number;
  pieces: PredictionContext;
}

/** All cache work is demand-driven. A pause is detected by the next request, never a timer. */
export class ContextAssembler {
  private readonly outlines = new OutlineCache();
  private readonly edits = new WeakMap<LanguageConnectionIdentity, Map<string, Snapshot>>();

  private editPieces(
    owner: LanguageConnectionIdentity,
    root: string,
    path: string,
    input: PredictionContextRequest,
    now: number
  ) {
    let files = this.edits.get(owner);

    if (files === undefined) {
      files = new Map();
      this.edits.set(owner, files);
    }

    const key = `${root}\0${path}`;
    const previous = files.get(key);

    const pieces =
      previous !== undefined && now - previous.at < 500
        ? previous.pieces
        : input.recentEdits.slice(-8).flatMap((edit) => {
            const target = resolve(root, edit.path);

            if (!within(root, target) || edit.to < edit.from) return [];

            return [
              PredictionContextPiece.make({
                kind: "editHunk",
                source: sourceName(root, target),
                text: `@@ UTF-16 ${edit.from}:${edit.to} @@\n${edit.text.slice(0, 2400)}`,
              }),
            ];
          });

    files.delete(key);
    files.set(key, { at: now, pieces });

    while (files.size > 32) files.delete(files.keys().next().value!);

    return pieces;
  }

  async assemble(
    owner: LanguageConnectionIdentity,
    root: string,
    path: string,
    input: PredictionContextRequest,
    source: LanguageSource | undefined,
    signal: AbortSignal,
    now = Date.now()
  ): Promise<PredictionContext> {
    signal.throwIfAborted();
    const parsed = await this.outlines.parse(path, input.buffer);
    const imports = await importedSources(root, path, parsed.imports, signal);
    const outlines: PredictionContextPiece[] = [];

    for (const imported of imports) {
      const outline = await this.outlines.parse(imported.path, imported.text);

      if (outline.signatures.length > 0)
        outlines.push(
          PredictionContextPiece.make({
            kind: "importOutline",
            source: sourceName(root, imported.path),
            text: outline.signatures.join("\n"),
          })
        );
    }

    const language =
      source === undefined
        ? []
        : await languagePieces(source, root, path, input.buffer, input.cursor, signal);

    signal.throwIfAborted();

    return budgetContext(
      language,
      outlines,
      this.editPieces(owner, root, path, input, now),
      input.budgetTokens
    );
  }
}
