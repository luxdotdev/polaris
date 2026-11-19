/**
 * Markdown to HTML through Words' core (ADR 0115): a whole document for static views, and a
 * session for a streamed message that keeps finished blocks and reparses only the open end.
 */
import { createHtmlSession, renderToHtml } from "@pierre/words";
import { useMemo, useState } from "react";
import { normalizeMath } from "./math.ts";

const decoder = new TextDecoder();

export interface HtmlOptions {
  /** Keep raw HTML (sanitized later); Review and the Editor preview. */
  readonly html: boolean;
  /** TeX between dollar signs as SVG; `\(…\)` and `\[…\]` too. */
  readonly math: boolean;
}

/** A whole document as HTML. */
export const renderHtml = (markdown: string, { html, math }: HtmlOptions): string =>
  decoder.decode(
    renderToHtml(math ? normalizeMath(markdown) : markdown, { skipHtml: !html, math })
  );

/** Top-level elements of an HTML fragment, each as its own HTML. */
export const splitBlocks = (html: string): Array<string> => {
  if (html === "") return [];
  const template = document.createElement("template");
  template.innerHTML = html;

  return Array.from(template.content.children, (element) => element.outerHTML);
};

export interface StreamBlocks {
  /** Finished blocks, each rendered once. */
  readonly stable: ReadonlyArray<string>;
  /** The open end, reparsed on every update; usually one block. */
  readonly pending: ReadonlyArray<string>;
}

/** A message's Words session: finished blocks keep their HTML, so they never re-render. */
export class BlockStream {
  private readonly session = createHtmlSession();
  private revision = 0;
  private stable: Array<string> = [];

  render(markdown: string, live: boolean): StreamBlocks {
    const update = this.session.render(normalizeMath(markdown), { incomplete: live, math: true });

    if (update.revision !== this.revision) {
      this.stable =
        update.reset || update.revision !== this.revision + 1
          ? splitBlocks(update.stable)
          : [...this.stable, ...splitBlocks(update.addition)];
      this.revision = update.revision;
    }

    return { stable: this.stable, pending: splitBlocks(update.pending) };
  }
}

/** The blocks of a message as it streams, from its own session. */
export const useStreamBlocks = (markdown: string, live: boolean): StreamBlocks => {
  const [stream] = useState(() => new BlockStream());

  return useMemo(() => stream.render(markdown, live), [stream, markdown, live]);
};
