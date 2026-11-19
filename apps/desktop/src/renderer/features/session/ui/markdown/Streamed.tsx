/**
 * An assistant message as Markdown, through Words (ADR 0115): incomplete syntax mid-stream renders
 * as it will end, finished blocks render once, math as SVG, code in the code font with a copy
 * action, Mermaid through Pele; links open in the user's browser (a Host address in the session's
 * Browser), and images and links naming a path open from the session's Host.
 */
import "./markdown.css";
import type { Element } from "hast";
import { type ComponentProps, useId, useMemo } from "react";
import { browserLinkOf } from "../../../browser/index.ts";
import { FileLink, useEditorPlace } from "../../../editor-links/index.ts";
import { BrowserLink } from "./BrowserLink.tsx";
import { CodeBlock } from "./code/CodeBlock.tsx";
import { COPY_TABLE } from "./copyControls.tsx";
import { editorLinkOf, rehypeFileLinks } from "./fileLinks.ts";
import { HostImage } from "./HostImage.tsx";
import { type HostPaths, hostImageOf, rehypeFileImages, rehypeHostImages } from "./hostImages.ts";
import { HostLink } from "./HostLink.tsx";
import { hostLinkOf, rehypeFileHrefs, rehypeHostLinks } from "./hostLinks.ts";
import { rehypeSoftBreaks } from "./softBreaks.ts";
import { type Components, Markup, type Pipeline } from "./words/Markup.tsx";
import { FragmentLink, isFragment, scoped } from "./words/fragments.tsx";
import { useStreamBlocks } from "./words/render.ts";
import { MATH_SCHEMA } from "./words/schema.ts";

// File URLs and drive paths become sanitizable paths first; Host images and links are marked after.
const pipelineFor = (host: HostPaths): Pipeline => ({
  before: [rehypeFileImages(host), rehypeFileHrefs(host)],
  schema: MATH_SCHEMA,
  after: [rehypeHostImages(host), rehypeHostLinks(host), rehypeFileLinks(), rehypeSoftBreaks()],
});

/** Drive paths are paths only on a Windows Host; on any other they stay URLs, as written. */
const PIPELINE_POSIX = pipelineFor({ windows: false });

const PIPELINE_WINDOWS = pipelineFor({ windows: true });

const LINK =
  "text-text-strong decoration-text-faint hover:decoration-text-subtle underline underline-offset-2";

interface Hast {
  readonly node?: Element;
}

const COMPONENTS: Components = {
  ...COPY_TABLE,
  pre: CodeBlock,
  // A path reads from the session's Host; a URL is an ordinary image.
  img: ({ node, ...props }: ComponentProps<"img"> & Hast) => {
    const path = hostImageOf(node?.properties);

    return path === null ? (
      <img {...props} alt={props.alt ?? ""} />
    ) : (
      <HostImage path={path} alt={props.alt ?? ""} />
    );
  },
  // `path:line` (rehypeFileLinks) opens in the editor, a Host path as `HostLink` says, a Host
  // address (localhost) in the session's Browser, other web links in the user's browser.
  a: ({ href, id, title, children, node }: ComponentProps<"a"> & Hast) => {
    if (isFragment(href))
      return (
        <FragmentLink href={href} id={id} className={LINK}>
          {children}
        </FragmentLink>
      );

    const target = editorLinkOf(node?.properties);
    const hostPath = hostLinkOf(node?.properties);

    if (hostPath !== null) return <HostLink path={hostPath}>{children}</HostLink>;

    const local = browserLinkOf(href);

    if (local !== null) return <BrowserLink url={local}>{children}</BrowserLink>;

    if (target !== null)
      return (
        <FileLink
          path={target.path}
          line={target.line}
          column={target.column}
          className={`${LINK} inline`}
        >
          {children}
        </FileLink>
      );

    return (
      <a href={href} id={id} title={title} target="_blank" rel="noreferrer" className={LINK}>
        {children}
      </a>
    );
  },
};

export interface StreamedProps {
  readonly text: string;
  readonly live: boolean;
}

const Streamed = ({ text, live }: StreamedProps) => {
  const { stable, pending } = useStreamBlocks(text, live);
  const base = useEditorPlace()?.windows === true ? PIPELINE_WINDOWS : PIPELINE_POSIX;
  const scope = useId();
  const pipeline = useMemo(() => scoped(base, scope), [base, scope]);

  return (
    <div className="polaris-md" data-streaming={live ? "" : undefined}>
      {[...stable, ...pending].map((html, index) => (
        // A block's position is its identity: blocks only append, the open end settles in place
        // as it finishes, and a reset re-renders only the blocks whose HTML changed.
        <Markup key={index} html={html} pipeline={pipeline} components={COMPONENTS} />
      ))}
    </div>
  );
};

export default Streamed;
