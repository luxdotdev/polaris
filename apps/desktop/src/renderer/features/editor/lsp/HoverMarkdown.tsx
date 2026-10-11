/**
 * Hover Markdown from a language server, as its own chunk: Streamdown with raw
 * HTML skipped, fences highlighted in the moonlit theme, https links only.
 */
import "../../session/ui/markdown/markdown.css";
import "./hover.css";
import { type Components, Streamdown } from "streamdown";
import { needsOf } from "../../session/ui/markdown/needs.ts";
import { usePlugins } from "../../session/ui/markdown/plugins.ts";
import { POLARIS_SHIKI } from "../../session/ui/markdown/theme.ts";

const LINK =
  "text-text-strong decoration-text-faint hover:decoration-text-subtle underline underline-offset-2";

const COMPONENTS: Components = {
  // Server links never navigate the app window; https opens in the user's browser.
  a: ({ href, children }) =>
    href?.startsWith("https://") ? (
      <a href={href} target="_blank" rel="noreferrer" className={LINK}>
        {children}
      </a>
    ) : (
      <span className="text-text-strong">{children}</span>
    ),
};

export const HoverMarkdown = ({ text }: { readonly text: string }) => {
  const plugins = usePlugins(needsOf(text));

  return (
    <Streamdown
      className="polaris-md polaris-hover-md"
      mode="static"
      skipHtml
      plugins={plugins}
      components={COMPONENTS}
      controls={false}
      shikiTheme={[POLARIS_SHIKI, POLARIS_SHIKI]}
      linkSafety={{ enabled: false }}
      lineNumbers={false}
    >
      {text}
    </Streamdown>
  );
};
