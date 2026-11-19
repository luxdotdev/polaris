/**
 * Language-server Markdown (hover, completion info, signature help), as its own chunk: Words
 * with raw HTML skipped and math on, fences in the moonlit theme, https links only.
 */
import "../../session/ui/markdown/markdown.css";
import type { Element } from "hast";
import { type ComponentProps, useMemo } from "react";
import { CodeBlock } from "../../session/ui/markdown/code/CodeBlock.tsx";
import { type Components, Markup, type Pipeline } from "../../session/ui/markdown/words/Markup.tsx";
import { renderHtml } from "../../session/ui/markdown/words/render.ts";
import { MATH_SCHEMA } from "../../session/ui/markdown/words/schema.ts";

const LINK =
  "text-text-strong decoration-text-faint hover:decoration-text-subtle underline underline-offset-2";

const PIPELINE: Pipeline = { schema: MATH_SCHEMA };

const COMPONENTS: Components = {
  // No header or Copy for a fence: compact code (DESIGN.md, Editor: Language docs).
  pre: ({ node }: { readonly node?: Element }) => <CodeBlock node={node} chrome={false} />,
  // Server links never navigate the app window; https opens in the user's browser.
  a: ({ href, children }: ComponentProps<"a">) =>
    href?.startsWith("https://") ? (
      <a href={href} target="_blank" rel="noreferrer" className={LINK}>
        {children}
        <span aria-hidden className="text-text-faint ml-0.5 no-underline">
          ↗
        </span>
      </a>
    ) : (
      <span className="text-text-strong">{children}</span>
    ),
};

export const DocMarkdown = ({ text }: { readonly text: string }) => {
  const html = useMemo(() => renderHtml(text, { html: false, math: true }), [text]);

  return (
    <div className="polaris-md polaris-doc-md">
      <Markup html={html} pipeline={PIPELINE} components={COMPONENTS} />
    </div>
  );
};
