/**
 * Review Markdown through Words (ADR 0115): GFM with raw HTML kept and sanitized (`<details>`
 * kept, comments dropped), then `rehypeReview` for alerts, `diff` blocks, folded tables and path
 * links. Links into the Review go to `renderLink`; others open in the browser.
 */
import "../../../../session/ui/markdown/markdown.css";
import "./review-md.css";
import { type ComponentProps, type ReactNode, useId, useMemo } from "react";
import { CodeBlock } from "../../../../session/ui/markdown/code/CodeBlock.tsx";
import {
  type Components,
  Markup,
  type Pipeline,
} from "../../../../session/ui/markdown/words/Markup.tsx";
import {
  FragmentLink,
  isFragment,
  scoped,
} from "../../../../session/ui/markdown/words/fragments.tsx";
import { renderHtml } from "../../../../session/ui/markdown/words/render.ts";
import { PROSE_SCHEMA } from "../../../../session/ui/markdown/words/schema.ts";
import { linkOf, prepareMarkdown, type ReviewLink, rehypeReview } from "../../model/markdown.ts";

const LINK =
  "text-text-strong decoration-text-faint hover:decoration-text-subtle underline underline-offset-2";

export interface RenderedProps {
  readonly markdown: string;
  /** The Review's changed paths: inline code and plain blocks naming one link into Changes. */
  readonly paths: ReadonlyArray<string>;
  readonly renderLink: (link: ReviewLink, children: ReactNode) => ReactNode;
}

const Rendered = ({ markdown, paths, renderLink }: RenderedProps) => {
  const html = useMemo(
    () => renderHtml(prepareMarkdown(markdown), { html: true, math: false }),
    [markdown]
  );

  const scope = useId();

  const pipeline: Pipeline = useMemo(
    () => scoped({ schema: PROSE_SCHEMA, after: [rehypeReview(paths)()] }, scope),
    [paths, scope]
  );

  const components: Components = {
    pre: CodeBlock,
    table: ({ node: _node, ...props }: ComponentProps<"table"> & { readonly node?: unknown }) => (
      <div data-md="table-wrapper">
        <table {...props} />
      </div>
    ),
    a: ({ href, id, children }: ComponentProps<"a">) => {
      if (isFragment(href))
        return (
          <FragmentLink href={href} id={id} className={LINK}>
            {children}
          </FragmentLink>
        );

      const link = linkOf(href ?? "");

      return link.kind === "external" ? (
        <a href={link.href} id={id} target="_blank" rel="noreferrer" className={LINK}>
          {children}
        </a>
      ) : (
        renderLink(link, children)
      );
    },
  };

  return (
    <div className="polaris-md review-md">
      <Markup html={html} pipeline={pipeline} components={components} />
    </div>
  );
};

export default Rendered;
