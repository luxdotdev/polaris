/**
 * The hover tooltip's content: each provider's label, then its parts.
 * Markdown renders sanitized through a lazily loaded chunk; plaintext stays text.
 */
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { HoverPart } from "./payloads.ts";

export interface HoverSection {
  readonly label: string;
  readonly parts: readonly HoverPart[];
}

type Renderer = typeof import("./HoverMarkdown.tsx");

let renderer: Renderer | null = null;

let loading: Promise<void> | null = null;

/** Resolves once the Markdown chunk is in (or failed, leaving plain text). */
export const loadHoverRenderer = () => {
  loading ??= import("./HoverMarkdown.tsx").then(
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
  <p className="break-words whitespace-pre-wrap">{text}</p>
);

const Part = ({ part }: { readonly part: HoverPart }) => {
  if (part.kind === "plaintext" || renderer === null) return <Plain text={part.text} />;

  const { HoverMarkdown } = renderer;

  return <HoverMarkdown text={part.text} />;
};

export const HoverView = ({ sections }: { readonly sections: readonly HoverSection[] }) => (
  <div className="text-body text-text-default flex max-h-80 max-w-[560px] flex-col gap-2 overflow-auto px-3 py-2">
    {sections.map((section, index) => (
      <section key={index} className="flex flex-col gap-1">
        <div className="text-caption text-text-subtle">{section.label}</div>
        {section.parts.map((part, at) => (
          <Part key={at} part={part} />
        ))}
      </section>
    ))}
  </div>
);

/** Renders synchronously so CodeMirror measures the filled tooltip. */
export const mountHover = (dom: HTMLElement, sections: readonly HoverSection[]) => {
  const root = createRoot(dom);

  flushSync(() => root.render(<HoverView sections={sections} />));

  return { destroy: () => queueMicrotask(() => root.unmount()) };
};
