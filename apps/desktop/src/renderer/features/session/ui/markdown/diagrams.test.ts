import "../../../../test/dom.testing.ts";
import { describe, expect, test } from "bun:test";
import * as pele from "pele";
import { guardedDiagrams } from "./diagrams.ts";

const SVG = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

const PIXEL = "data:image/png;base64,iVBORw0KGgo=";

const closed = (code: string) => ({ code, language: "mermaid", isIncomplete: false });

/** Pele's API with its render replaced by one that returns `svg`. */
const fake = (svg: string) => guardedDiagrams({ render: () => ({ svg }) });

describe("Pele draws a diagram, or the fence shows as code", () => {
  test.each([
    "flowchart LR\n A[Start] --> B{Ok?}",
    "sequenceDiagram\n participant A\n A->>B: hi",
    "classDiagram\n class Animal",
    "stateDiagram-v2\n [*] --> Idle",
    "erDiagram\n A ||--o{ B : has",
    "mindmap\n  root\n    child",
  ])("an ordinary diagram draws: %s", (source) => {
    expect(guardedDiagrams(pele).render(closed(source))).toContain("<svg");
  });

  test.each([
    ["a broken edge", "flowchart LR\n A -->"],
    ["no diagram type", "not a diagram at all"],
  ])("%s shows the code", (_, source) => {
    expect(guardedDiagrams(pele).render(closed(source))).toBeNull();
  });

  test.each([
    ["an image node", `flowchart LR\n A@{ img: "${PIXEL}" }`],
    ["a click link", 'flowchart LR\n A --> B\n click A "https://example.com"'],
    ["a directive", '%%{init: {"htmlLabels": true}}%%\nflowchart LR\n A --> B'],
  ])("%s draws nothing that loads or links", (_, source) => {
    const html = guardedDiagrams(pele).render(closed(source)) ?? "";

    expect(html).not.toMatch(/<image|<img|<a[\s>]|href=|<foreignObject/i);
  });
});

describe("a rendered diagram that would load a resource is not shown", () => {
  test.each([
    ["an image element", `<image href="${PIXEL}"/>`],
    [
      "an HTML image in a label",
      `<foreignObject><img xmlns="http://www.w3.org/1999/xhtml" src="${PIXEL}"/></foreignObject>`,
    ],
    ["a style URL", `<style>svg { background: url(${PIXEL}) }</style>`],
    ["an escaped style URL", `<style>svg { background: \\75 rl(${PIXEL}) }</style>`],
    ["an attribute paint", `<rect fill="url('${PIXEL}')"/>`],
    ["an external use", `<use href="${PIXEL}"/>`],
    ["an event handler", '<rect onclick="alert(1)"/>'],
    ["a link", '<a href="https://example.com"><text>x</text></a>'],
  ])("%s", (_, body) => {
    expect(fake(SVG(body)).render(closed("flowchart LR\n A --> B"))).toBeNull();
  });

  test("markers and links within the document still render", () => {
    const svg = SVG(
      '<defs><marker id="arrow"/></defs><path style="marker-end:url(#arrow)"/><use href="#arrow"/>'
    );

    expect(fake(svg).render(closed("flowchart LR\n A --> B"))).toContain('<marker id="arrow"/>');
  });
});
