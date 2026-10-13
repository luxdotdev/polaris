/**
 * Language-server docs, one look for every server (DESIGN.md, Editor: Language docs):
 * hover, completion info and signature help. Markdown renders sanitized through a
 * lazily loaded chunk; plaintext stays text; the server is a footnote, never a header.
 */
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "./docs.css";
import type { HoverPart } from "./payloads.ts";

/** A signature line in the code font, its active parameter at `active` (UTF-16 offsets). */
export interface SignaturePart {
  readonly kind: "signature";
  readonly text: string;
  readonly active?: readonly [number, number];
}

export type DocPart = HoverPart | SignaturePart;

export interface Docs {
  /** Each provider's parts, a hairline between providers. */
  readonly sections: readonly (readonly DocPart[])[];
  /** Who answered, e.g. "TypeScript 6.0.3 · bundled"; omitted inside the completion info. */
  readonly footnote?: string;
  /** `hover` sizes to its content up to 560px; `panel` is the completion info's fixed 360px. */
  readonly variant: "hover" | "panel";
}

type Renderer = typeof import("./DocMarkdown.tsx");

let renderer: Renderer | null = null;

let loading: Promise<void> | null = null;

/** Resolves once the Markdown chunk is in (or failed, leaving plain text). */
export const loadDocRenderer = () => {
  loading ??= import("./DocMarkdown.tsx").then(
    (module) => {
      renderer = module;
    },
    () => {
      loading = null;
    }
  );

  return loading;
};

const Plain = ({ text }: { readonly text: string }) => (
  <p className="whitespace-pre-wrap">{text}</p>
);

const Signature = ({ part }: { readonly part: SignaturePart }) => {
  const [from, to] = part.active ?? [0, 0];

  return (
    <pre data-doc-signature className="polaris-doc-signature">
      {part.text.slice(0, from)}
      {to > from && <span data-doc-active>{part.text.slice(from, to)}</span>}
      {part.text.slice(Math.max(from, to))}
    </pre>
  );
};

const Part = ({ part }: { readonly part: DocPart }) => {
  if (part.kind === "signature") return <Signature part={part} />;

  if (part.kind === "plaintext" || renderer === null) return <Plain text={part.text} />;

  const { DocMarkdown } = renderer;

  return <DocMarkdown text={part.text} />;
};

const WIDTH = { hover: "max-w-[560px]", panel: "w-[360px]" } as const;

export const DocView = ({ docs }: { readonly docs: Docs }) => (
  <div
    data-language-docs={docs.variant}
    className={`text-body text-text-default flex max-h-80 flex-col ${WIDTH[docs.variant]}`}
  >
    <div className="flex min-h-0 flex-col gap-1.5 overflow-auto px-3 pt-2.5 pb-3 [overflow-wrap:anywhere]">
      {docs.sections.map((parts, index) => (
        <section
          key={index}
          className="border-hairline flex flex-col gap-1.5 [&+&]:border-t [&+&]:pt-2"
        >
          {parts.map((part, at) => (
            <Part key={at} part={part} />
          ))}
        </section>
      ))}
    </div>
    {docs.footnote && (
      <div
        data-docs-footnote
        className="text-micro text-text-faint border-hairline flex h-6 shrink-0 items-center truncate border-t px-3"
      >
        {docs.footnote}
      </div>
    )}
  </div>
);

/** Renders synchronously so CodeMirror measures the filled tooltip. */
export const mountDocs = (dom: HTMLElement, docs: Docs) => {
  const root = createRoot(dom);

  flushSync(() => root.render(<DocView docs={docs} />));

  return { destroy: () => queueMicrotask(() => root.unmount()) };
};
