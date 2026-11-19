/**
 * A fenced code block in any Markdown view: a header with its language and the shared
 * CopyButton, then the code, highlighted once the highlighter loads (`highlighter.ts`). While a
 * fence streams, completed lines highlight as they arrive and the unfinished line shows as text.
 * A `mermaid` fence draws its diagram with Pele, or shows as code when it doesn't parse.
 */
import { CopyButton } from "@polaris/ui";
import type { Element, ElementContent } from "hast";
import { Fragment, memo, useEffect, useMemo } from "react";
import type { CodeHighlighter } from "./highlighter.ts";
import { usePlugins } from "../plugins.ts";
import { trustedHtml } from "../words/Markup.tsx";

const textOf = (node: ElementContent | undefined): string => {
  if (node === undefined) return "";

  if (node.type === "text") return node.value;

  return node.type === "element" ? node.children.map(textOf).join("") : "";
};

export interface Fence {
  readonly code: string;
  readonly language: string;
  /** Still streaming: the closing fence hasn't arrived. */
  readonly incomplete: boolean;
}

interface Shown extends Fence {
  /** The header with the language and Copy; language docs show bare code. */
  readonly chrome: boolean;
}

/** The fence a `<pre>` holds: its code, its language (`language-…` on the `<code>`), whether it's open. */
export const fenceOf = (pre: Element | undefined): Fence => {
  const code = pre?.children.find((child) => child.type === "element" && child.tagName === "code");
  const classes = code?.type === "element" ? code.properties["className"] : undefined;

  const language = Array.isArray(classes)
    ? (classes
        .map(String)
        .find((name) => name.startsWith("language-"))
        ?.slice(9) ?? "")
    : "";

  return {
    // Raw `<pre>` HTML (a Review, a document) may hold its text with no `<code>` inside. An open
    // fence always ends in a newline from Words, so its last line stays unfinished until the next.
    code: (code === undefined ? textOf(pre) : textOf(code)).replace(/\n$/, ""),
    language,
    incomplete: pre?.properties["dataMarkdownIncomplete"] !== undefined,
  };
};

const Header = ({ language, code }: { readonly language: string; readonly code: string }) => (
  <div data-md="code-header">
    <span>{language}</span>
    <CopyButton variant="icon" label="Copy code" text={() => code} />
  </div>
);

/** One highlighted line; unchanged lines keep their DOM while the block streams. */
const Line = memo(({ html }: { readonly html: string }) => (
  <span className="line">{trustedHtml(html)}</span>
));

interface Highlighted {
  readonly lines: ReadonlyArray<string>;
  readonly tail: string;
}

/** The fence's lines as HTML and its unfinished tail; a streaming fence tokenizes only what's new. */
const useHighlighted = (
  highlighter: CodeHighlighter | undefined,
  { code, language, incomplete }: Fence
): Highlighted | null => {
  const stream = useMemo(
    () => (incomplete ? highlighter?.stream(language) : undefined),
    [highlighter, language, incomplete]
  );

  useEffect(() => () => stream?.dispose(), [stream]);

  if (highlighter === undefined) return null;

  // The stream's state follows `code` alone, so a render React discards changes nothing.
  return stream === undefined
    ? { lines: highlighter.lines(code, language), tail: "" }
    : stream.update(code);
};

const Code = (fence: Shown) => {
  const { code: highlighter } = usePlugins({ code: true, mermaid: false });
  const highlighted = useHighlighted(highlighter, fence);

  return (
    <div data-md="code-block" data-copy="code">
      {fence.chrome ? <Header language={fence.language} code={fence.code} /> : null}
      <pre>
        <code>
          {highlighted === null
            ? fence.code
            : highlighted.lines.map((html, at) => (
                // Lines only append while a fence streams, so a line's index is its identity.
                // oxlint-disable-next-line react/no-array-index-key -- see above
                <Fragment key={at}>
                  {at > 0 ? "\n" : null}
                  <Line html={html} />
                </Fragment>
              ))}
          {highlighted === null || highlighted.tail === ""
            ? null
            : `${highlighted.lines.length > 0 ? "\n" : ""}${highlighted.tail}`}
        </code>
      </pre>
    </div>
  );
};

const Diagram = (fence: Shown) => {
  const { mermaid } = usePlugins({ code: false, mermaid: true });

  const svg = useMemo(
    () =>
      mermaid?.render({ code: fence.code, language: "mermaid", isIncomplete: fence.incomplete }),
    [mermaid, fence.code, fence.incomplete]
  );

  // Pele's SVG skips the hast sanitizer: the pinned Pele's label escaping and our resource guard keep
  // it inert. On any Pele upgrade, re-run diagrams.test.ts's hostile labels (ADR 0115).
  const drawn = useMemo(() => (svg === undefined || svg === null ? null : trustedHtml(svg)), [svg]);

  // Not loaded yet, or a finished diagram that doesn't parse: the source, as code.
  if (drawn === null) return <Code {...fence} />;

  return (
    <div data-md="code-block" data-md-diagram="" data-copy="code">
      {fence.chrome ? <Header language="mermaid" code={fence.code} /> : null}
      {/* Pele's SVG, checked by `guardedRenderer` to load nothing. */}
      <div data-md="diagram">{drawn}</div>
    </div>
  );
};

/** The one place Markdown draws a fenced code block (the `pre` component of every view). */
export const CodeBlock = ({
  node,
  chrome = true,
}: {
  readonly node?: Element | undefined;
  readonly chrome?: boolean;
}) => {
  const fence = { ...fenceOf(node), chrome };

  return fence.language === "mermaid" ? <Diagram {...fence} /> : <Code {...fence} />;
};
