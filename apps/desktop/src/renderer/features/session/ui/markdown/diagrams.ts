/**
 * The one Mermaid plugin every renderer view uses (transcript, language-server docs, the editor's
 * Markdown preview). Diagram source comes from a Host, so a render loads no image: strict security,
 * plain-text labels, no source configuration, no image or icon on a parsed node, and no resource
 * reference in the SVG it returns.
 */
import type { Mermaid, MermaidConfig } from "mermaid";
import type { DiagramPlugin } from "streamdown";
import { Option, Schema } from "effect";

export type DiagramEngine = Pick<Mermaid, "initialize" | "parse" | "render" | "mermaidAPI">;

export class UnsafeDiagram extends Error {
  constructor(reason: string) {
    super(`Diagram not shown: ${reason}`);
    this.name = "UnsafeDiagram";
  }
}

const DEFAULTS: MermaidConfig = {
  startOnLoad: false,
  theme: "default",
  fontFamily: "monospace",
  suppressErrorRendering: true,
};

/** HTML labels would build elements (an `<img>` among them) from label text. */
const pinned = (config: MermaidConfig): MermaidConfig => ({
  ...DEFAULTS,
  ...config,
  securityLevel: "strict",
  htmlLabels: false,
  flowchart: { ...config.flowchart, htmlLabels: false },
});

/** The methods of Mermaid's diagram databases that return what can carry an image; they vary by diagram. */
export interface DiagramData {
  /** Flowchart, kanban, mindmap and the other unified-layout diagrams: nodes with `img`/`icon`. */
  readonly getData?: () => { readonly nodes: ReadonlyArray<object> };
  /** Sequence diagrams: participants with `properties.icon`. */
  readonly getActors?: () => ReadonlyMap<string, object>;
}

/** Absent, or empty: what an `img`, `icon` or participant icon holds when it loads nothing. */
const Nothing = Schema.optional(Schema.NullOr(Schema.Literal("")));

const decodeLayout = Schema.decodeUnknownOption(
  Schema.Struct({ nodes: Schema.Array(Schema.Struct({ img: Nothing, icon: Nothing })) })
);

const decodeActors = Schema.decodeUnknownOption(
  Schema.ReadonlyMap(
    Schema.String,
    Schema.Struct({ properties: Schema.optional(Schema.NullOr(Schema.Struct({ icon: Nothing }))) })
  )
);

/** Whether a parsed diagram would load an image: a layout node or participant names one, or can't be read. */
export const parsedLoads = (db: DiagramData): boolean =>
  (db.getData !== undefined && Option.isNone(decodeLayout(db.getData()))) ||
  (db.getActors !== undefined && Option.isNone(decodeActors(db.getActors())));

const IMAGE_ELEMENTS = new Set([
  "image",
  "img",
  "feimage",
  "picture",
  "source",
  "video",
  "audio",
  "iframe",
  "object",
  "embed",
  "script",
]);

const REFERENCE_ATTRIBUTES = new Set(["href", "xlink:href", "src", "srcset", "poster", "data"]);

const MAX_CODE_POINT = 0x10ffff;

/** CSS text with its escapes resolved, so `\75 rl(` reads as `url(`. */
const unescapeCss = (css: string) =>
  css.replace(/\\([0-9a-f]{1,6})\s?|\\([^])/gi, (_, hex: string | undefined, char: string) => {
    if (hex === undefined) return char;

    const point = Number.parseInt(hex, 16);

    return point === 0 || point > MAX_CODE_POINT ? "\u{fffd}" : String.fromCodePoint(point);
  });

/** Whether CSS (a `<style>` or an attribute) loads anything but a same-document fragment. */
export const cssLoads = (css: string): boolean => {
  const text = unescapeCss(css).toLowerCase();

  if (/(?:image-set|image|cross-fade|element|src)\s*\(/.test(text)) return true;

  for (const [, target = ""] of text.matchAll(/url\s*\(\s*['"]?\s*([^'")\s]*)/g))
    if (!target.startsWith("#")) return true;

  return false;
};

/** Why one SVG element would load something, or null. */
const elementResource = (element: Element): string | null => {
  const name = element.localName.toLowerCase();

  if (IMAGE_ELEMENTS.has(name)) return `it draws <${name}>`;

  if (name === "style" && cssLoads(element.textContent ?? "")) return "its styles load a resource";

  for (const attribute of element.attributes) {
    const reference = REFERENCE_ATTRIBUTES.has(attribute.name.toLowerCase());

    if (reference && name !== "a" && !attribute.value.trim().startsWith("#"))
      return `<${name}> references a resource`;

    if (cssLoads(attribute.value)) return `<${name}> loads a resource`;
  }

  return null;
};

/** Why a rendered SVG would load something when inserted, or null. */
export const renderedResource = (svg: string): string | null => {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");

  if (document.querySelector("parsererror") !== null) return "its SVG couldn't be read";

  for (const element of document.querySelectorAll("*")) {
    const reason = elementResource(element);

    if (reason !== null) return reason;
  }

  return null;
};

let queue: Promise<unknown> = Promise.resolve();

/** Mermaid keeps some diagrams' databases per module, so checks and renders never interleave. */
const serial = <A>(task: () => Promise<A>): Promise<A> => {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);

  return run;
};

export const guardedDiagrams = (mermaid: DiagramEngine): DiagramPlugin => {
  let config = pinned({});
  let ready = false;

  const check = async (source: string) => {
    if (Object.keys((await mermaid.parse(source)).config).length > 0)
      throw new UnsafeDiagram("it sets its own configuration");

    const { db } = await mermaid.mermaidAPI.getDiagramFromText(source);

    // SAFETY: each method is checked before it's called, and what it returns is decoded before use.
    if (parsedLoads(db as DiagramData))
      throw new UnsafeDiagram("a node or participant has an image");
  };

  // Method syntax: Streamdown's structural config type is wider than Mermaid's; Polaris passes Mermaid's.
  const engine = {
    initialize(next: MermaidConfig) {
      config = pinned(next);
      mermaid.initialize(config);
      ready = true;
    },
    render(id: string, source: string) {
      return serial(async () => {
        if (!ready) engine.initialize(config);

        await check(source);
        const { svg } = await mermaid.render(id, source);
        const reason = renderedResource(svg);

        if (reason !== null) throw new UnsafeDiagram(reason);

        return { svg };
      });
    },
  };

  return {
    name: "mermaid",
    type: "diagram",
    language: "mermaid",
    getMermaid(next?: MermaidConfig) {
      if (next !== undefined) engine.initialize(next);

      return engine;
    },
  };
};
