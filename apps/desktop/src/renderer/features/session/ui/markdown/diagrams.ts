/**
 * The one Mermaid plugin every renderer view uses: Pele through Words' `createMermaidPlugin`.
 * Diagram source comes from a Host, so a render loads nothing: Pele draws no image or link, and an
 * SVG that would still reference a resource is refused. Refused or unparseable, it shows as code.
 */
import type { MermaidPlugin } from "@pierre/words/html";
import { createMermaidPlugin, type MermaidRenderer } from "@pierre/words/mermaid";

export class UnsafeDiagram extends Error {
  constructor(reason: string) {
    super(`Diagram not shown: ${reason}`);
    this.name = "UnsafeDiagram";
  }
}

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
  "foreignobject",
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

  if (name === "a") return "it links";

  for (const attribute of element.attributes) {
    if (attribute.name.toLowerCase().startsWith("on")) return `<${name}> handles events`;

    const reference = REFERENCE_ATTRIBUTES.has(attribute.name.toLowerCase());

    if (reference && !attribute.value.trim().startsWith("#"))
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

/** Pele's options: no images, no links, text measured in the app's own type. */
export interface DiagramOptions {
  readonly fontFamily: string;
  readonly fontFamilyMono: string;
  readonly images: false;
  readonly links: false;
}

export const DIAGRAM_OPTIONS: DiagramOptions = {
  // `--font-sans` and `--font-mono` (tokens.css): Pele measures text with them before CSS applies.
  fontFamily:
    'system-ui, -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", sans-serif',
  fontFamilyMono:
    'ui-monospace, "SF Mono", SFMono-Regular, Menlo, "Cascadia Mono", Consolas, monospace',
  images: false,
  links: false,
};

/** Pele's render, refusing any SVG that would load a resource (the plugin then shows the code). */
export const guardedRenderer = <Options>(
  pele: MermaidRenderer<Options>
): MermaidRenderer<Options> => ({
  render(source, options) {
    const out = pele.render(source, options);
    const reason = renderedResource(out.svg);

    if (reason !== null) throw new UnsafeDiagram(reason);

    return out;
  },
});

export const guardedDiagrams = <Options extends Partial<DiagramOptions>>(
  pele: MermaidRenderer<Options>
): MermaidPlugin =>
  // SAFETY: Pele's RenderOptions accept every field of DiagramOptions.
  createMermaidPlugin(guardedRenderer(pele), DIAGRAM_OPTIONS as Options);
