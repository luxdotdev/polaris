/**
 * An assistant message as Markdown (Streamdown): incomplete syntax mid-stream
 * renders as it will end, code in the code font with a copy action, Mermaid
 * and KaTeX once their plugins load, links open in the browser.
 */
import "./markdown.css";
import { type Components, type ControlsConfig, defaultRehypePlugins, Streamdown } from "streamdown";
import { FileLink } from "../../../editor-links/index.ts";
import { COPY_CODE, COPY_TABLE } from "./copyControls.tsx";
import { editorLinkOf, rehypeFileLinks } from "./fileLinks.ts";
import { needsOf } from "./needs.ts";
import { rehypeSoftBreaks } from "./softBreaks.ts";
import { usePlugins } from "./plugins.ts";
import { MERMAID_CONFIG, POLARIS_SHIKI } from "./theme.ts";

// Copy is Polaris's own CopyButton (`copyControls.tsx`), not Streamdown's.
const CONTROLS: ControlsConfig = {
  code: { copy: false, download: false },
  table: { copy: false, download: false, fullscreen: false },
  mermaid: { copy: false, download: false, fullscreen: false, panZoom: false },
};

// After sanitizing, so the `<wbr>` and the editor links they add stay.
const REHYPE = [...Object.values(defaultRehypePlugins), rehypeFileLinks, rehypeSoftBreaks];

const COMPONENTS: Components = {
  ...COPY_CODE,
  ...COPY_TABLE,
  // `path:line` (rehypeFileLinks) opens in the editor; other links in the user's browser (https only).
  a: ({ href, children, node }) => {
    const target = editorLinkOf(node?.properties);

    if (target !== null)
      return (
        <FileLink
          path={target.path}
          line={target.line}
          column={target.column}
          className="text-text-strong decoration-text-faint hover:decoration-text-subtle inline underline underline-offset-2"
        >
          {children}
        </FileLink>
      );

    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-text-strong decoration-text-faint hover:decoration-text-subtle underline underline-offset-2"
      >
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
  const plugins = usePlugins(needsOf(text));

  return (
    <Streamdown
      className="polaris-md"
      isAnimating={live}
      plugins={plugins}
      rehypePlugins={REHYPE}
      components={COMPONENTS}
      controls={CONTROLS}
      shikiTheme={[POLARIS_SHIKI, POLARIS_SHIKI]}
      linkSafety={{ enabled: false }}
      lineNumbers={false}
      {...(plugins.mermaid === undefined ? {} : { mermaid: { config: MERMAID_CONFIG } })}
    >
      {text}
    </Streamdown>
  );
};

export default Streamed;
