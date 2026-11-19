/**
 * What rendered Markdown may hold, for every view (ADR 0115). GitHub's set (details, summary, img,
 * sub, sup, tables, task lists, footnotes), ids prefixed `user-content-` and `tel:` links; never a
 * script, an event handler, a style or a `javascript:` URL. Math adds Words' own SVG elements.
 */
import { defaultSchema, type Schema } from "hast-util-sanitize";

const BASE_ATTRIBUTES = defaultSchema.attributes ?? {};

const BASE_PROTOCOLS = defaultSchema.protocols ?? {};

/** Raw HTML from a Review or a document: GitHub's set. */
export const PROSE_SCHEMA: Schema = {
  ...defaultSchema,
  protocols: { ...BASE_PROTOCOLS, href: [...(BASE_PROTOCOLS["href"] ?? []), "tel"] },
  attributes: {
    ...BASE_ATTRIBUTES,
    code: [...(BASE_ATTRIBUTES["code"] ?? []), "metastring"],
    // An open fence while a message streams.
    pre: ["dataMarkdownIncomplete"],
  },
};

/** Only the layout properties Words writes on its formulas; nothing that can load a resource. */
const MATH_STYLE =
  /^(?:\s*(?:display|margin|overflow|vertical-align|white-space)\s*:\s*[-\w.\s]+;?)+$/;

/** Words' Markdown with math: its formula SVG (`svg`, `g`, `text`, `rect`, `path`) as well. */
export const MATH_SCHEMA: Schema = {
  ...PROSE_SCHEMA,
  tagNames: [...(PROSE_SCHEMA.tagNames ?? []), "svg", "g", "text", "rect", "path"],
  attributes: {
    ...PROSE_SCHEMA.attributes,
    svg: ["viewBox", "fill", "fontFamily", ["role", "img"], "ariaLabel", ["style", MATH_STYLE]],
    g: ["fontSize", "fill", "transform"],
    text: ["x", "y", "fontSize", ["style", MATH_STYLE]],
    rect: ["x", "y"],
    path: ["d", "fill", "stroke", "strokeWidth"],
  },
};
