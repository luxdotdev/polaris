import "../../session/ui/markdown/markdown.css";
import "./preview.css";
import { useRef, useState, useMemo } from "react";
import { Predicate } from "effect";
import { Streamdown, type PluginConfig, type Components } from "streamdown";
import { needsOf } from "../../session/ui/markdown/needs.ts";
import { usePlugins } from "../../session/ui/markdown/plugins.ts";
import { MERMAID_CONFIG, POLARIS_SHIKI } from "../../session/ui/markdown/theme.ts";
import { PreviewImage } from "./Image.tsx";
import { previewTarget, type PreviewDocument } from "./targets.ts";
import { previewDiagrams } from "./diagrams.ts";
import { PREVIEW_REHYPE, SAFE_HTML_COMPONENTS } from "./pipeline.tsx";
import type { PreviewMediaPool } from "./media.ts";

export interface RenderedProps {
  readonly source: string;
  readonly document: PreviewDocument;
  readonly pool: PreviewMediaPool | null;
  readonly openDocument: (document: PreviewDocument, fragment: string) => Promise<void>;
  readonly openExternal: (url: string) => Promise<void>;
}

const Rendered = ({ source, document, pool, openDocument, openExternal }: RenderedProps) => {
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const needs = needsOf(source);
  const plugins = usePlugins({ ...needs, math: false });
  const enabledPlugins: PluginConfig = {};

  if (needs.code && plugins.code) enabledPlugins.code = plugins.code;

  const diagrams = useMemo(
    () => (plugins.mermaid ? previewDiagrams(plugins.mermaid) : undefined),
    [plugins.mermaid]
  );

  if (needs.mermaid && diagrams) enabledPlugins.mermaid = diagrams;

  const fragment = (name: string) => {
    const target = Array.from(root.current?.querySelectorAll<HTMLElement>("[id]") ?? []).find(
      (element) => [name, `preview-${name}`, `user-content-${name}`].includes(element.id)
    );

    target?.scrollIntoView({ behavior: "instant", block: "start" });
    target?.focus({ preventScroll: true });
  };

  const navigate = async (href: string) => {
    setError(null);
    const target = previewTarget(href, document);

    if (target.kind === "fragment") {
      fragment(target.fragment);

      return;
    }

    if (target.kind === "file")
      await openDocument({ ...document, path: target.path }, target.fragment);

    if (target.kind === "external") await openExternal(target.url);
  };

  const imageComponent = useMemo<NonNullable<Components["img"]>>(
    () =>
      ({ src, alt }) => (
        <PreviewImage source={Predicate.isString(src) ? src : ""} alt={alt ?? ""} pool={pool} />
      ),
    [pool]
  );

  const components: Components = useMemo(
    () => ({
      img: imageComponent,
      ...SAFE_HTML_COMPONENTS,
      a: ({ href, id, children }) =>
        previewTarget(href ?? "", document).kind === "blocked" ? (
          <span id={id} tabIndex={-1}>
            {children}
          </span>
        ) : (
          <a
            href="#"
            id={id}
            onAuxClick={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              void navigate(href ?? "").catch(() => setError("Couldn’t open link"));
            }}
          >
            {children}
          </a>
        ),
    }),
    [document, imageComponent, openDocument, openExternal]
  );

  return (
    <div ref={root}>
      {error && <p role="status">{error}</p>}
      <Streamdown
        className="polaris-md editor-markdown"
        mode="static"
        plugins={enabledPlugins}
        rehypePlugins={PREVIEW_REHYPE}
        components={components}
        controls={{
          code: { copy: true, download: false },
          table: false,
          mermaid: { copy: true, download: false, fullscreen: false, panZoom: false },
        }}
        shikiTheme={[POLARIS_SHIKI, POLARIS_SHIKI]}
        mermaid={{ config: MERMAID_CONFIG }}
        linkSafety={{ enabled: false }}
        lineNumbers={false}
      >
        {source}
      </Streamdown>
    </div>
  );
};

export default Rendered;
