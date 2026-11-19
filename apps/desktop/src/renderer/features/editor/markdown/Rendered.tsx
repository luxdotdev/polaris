import "../../session/ui/markdown/markdown.css";
import "./preview.css";
import { type ComponentProps, useRef, useState, useMemo } from "react";
import { Predicate } from "effect";
import { CodeBlock } from "../../session/ui/markdown/code/CodeBlock.tsx";
import { type Components, Markup } from "../../session/ui/markdown/words/Markup.tsx";
import { renderHtml } from "../../session/ui/markdown/words/render.ts";
import { PreviewImage } from "./Image.tsx";
import { previewTarget, type PreviewDocument } from "./targets.ts";
import { PREVIEW_PIPELINE, SAFE_HTML_COMPONENTS } from "./pipeline.tsx";
import type { PreviewMediaPool } from "./media.ts";

export interface RenderedProps {
  readonly source: string;
  readonly document: PreviewDocument;
  readonly pool: PreviewMediaPool | null;
  readonly openDocument: (document: PreviewDocument, fragment: string) => Promise<void>;
  readonly openExternal: (url: string) => Promise<void>;
  /** Called as each external image mounts; the returned function, as it unmounts. */
  readonly externalImage?: (() => () => void) | undefined;
}

const Rendered = ({
  source,
  document,
  pool,
  openDocument,
  openExternal,
  externalImage,
}: RenderedProps) => {
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const html = useMemo(() => renderHtml(source, { html: true, math: false }), [source]);

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

  const imageComponent = useMemo(
    () =>
      ({ src, alt }: ComponentProps<"img">) => {
        const source = Predicate.isString(src) ? src : "";
        const external = previewTarget(source, document).kind === "external";

        return (
          <PreviewImage
            source={source}
            alt={alt ?? ""}
            pool={pool}
            shown={external ? externalImage : undefined}
          />
        );
      },
    [pool, document, externalImage]
  );

  const components: Components = useMemo(
    () => ({
      img: imageComponent,
      pre: CodeBlock,
      // A wide table scrolls on its own rather than widening the page.
      table: ({ node: _node, ...props }: ComponentProps<"table"> & { readonly node?: unknown }) => (
        <div data-md="table-wrapper">
          <table {...props} />
        </div>
      ),
      ...SAFE_HTML_COMPONENTS,
      a: ({ href, id, children }: ComponentProps<"a">) =>
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
      <div className="polaris-md editor-markdown">
        <Markup html={html} pipeline={PREVIEW_PIPELINE} components={components} />
      </div>
    </div>
  );
};

export default Rendered;
