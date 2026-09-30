/**
 * An assistant message as Markdown (Streamdown): incomplete syntax mid-stream
 * renders as it will end, code in the code font with a copy action, Mermaid
 * and KaTeX once their plugins load, links open in the browser.
 */
import "./markdown.css";
import { type Components, type ControlsConfig, defaultRehypePlugins, Streamdown } from "streamdown";
import { needsOf } from "./needs.ts";
import { rehypeSoftBreaks } from "./softBreaks.ts";
import { usePlugins } from "./plugins.ts";
import { MERMAID_CONFIG, POLARIS_SHIKI } from "./theme.ts";

const CONTROLS: ControlsConfig = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: false },
  mermaid: { copy: true, download: false, fullscreen: false, panZoom: false },
};

// After sanitizing, so the `<wbr>` it adds stays.
const REHYPE = [...Object.values(defaultRehypePlugins), rehypeSoftBreaks];

const COMPONENTS: Components = {
  // Opened by the window's handler in the user's browser (https only).
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-text-strong decoration-text-faint hover:decoration-text-subtle underline underline-offset-2"
    >
      {children}
    </a>
  ),
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
