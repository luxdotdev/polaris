import "../../../../test/dom.testing.ts";
import { strict as assert } from "node:assert";
import { describe, expect, test } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import mermaid from "mermaid";
import { guardedDiagrams } from "./diagrams.ts";
import { usePlugins } from "./plugins.ts";

const SVG = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

const PIXEL = "data:image/png;base64,iVBORw0KGgo=";

/** Real Mermaid parsing, with its render (which needs a layout engine) replaced by `svg`. */
const engine = (svg = SVG("<g/>")) => {
  const renders: string[] = [];

  const plugin = guardedDiagrams({
    ...mermaid,
    render: (_id, source) => {
      renders.push(source);

      return Promise.resolve({ svg, diagramType: "flowchart-v2" });
    },
  });

  return { renders, render: (source: string) => plugin.getMermaid().render("d", source) };
};

describe("a diagram's parsed nodes never ask for an image", () => {
  test.each([
    ["an image node", `flowchart LR\n A@{ img: "${PIXEL}" }`],
    ["a YAML-escaped image key", `flowchart LR\n A@{ "\\x69mg": "${PIXEL}" }`],
    ["an icon node", 'flowchart LR\n A@{ icon: "fa:user" }'],
    ["a participant icon", 'sequenceDiagram\n participant A\n properties A: {"icon": "shot.png"}'],
    ["a directive", '%%{init: {"htmlLabels": true}}%%\nflowchart LR\n A --> B'],
    ["front matter", "---\nconfig:\n  htmlLabels: true\n---\nflowchart LR\n A --> B"],
  ])("%s is refused before Mermaid renders", async (_, source) => {
    const { renders, render } = engine();

    await assert.rejects(render(source), /Diagram not shown/);
    await render("flowchart LR\n A --> B");
    expect(renders).toEqual(["flowchart LR\n A --> B"]);
  });
});

test.each([
  "flowchart LR\n A[Start] --> B{Ok?}",
  "sequenceDiagram\n participant A\n A->>B: hi",
  "classDiagram\n class Animal",
  "stateDiagram-v2\n [*] --> Idle",
  "erDiagram\n A ||--o{ B : has",
  "mindmap\n  root\n    child",
  "architecture-beta\n  service db(database)[DB]",
])("an ordinary diagram reaches Mermaid: %s", async (source) => {
  const { renders, render } = engine();

  await render(source);
  expect(renders).toEqual([source]);
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
  ])("%s", async (_, body) => {
    await assert.rejects(engine(SVG(body)).render("flowchart LR\n A --> B"), /Diagram not shown/);
  });

  test("markers and links within the document still render", async () => {
    const svg = SVG(
      '<defs><marker id="arrow"/></defs><path style="marker-end:url(#arrow)"/><use href="#arrow"/>'
    );

    expect(await engine(svg).render("flowchart LR\n A --> B")).toEqual({ svg });
  });
});

test("the plugin every Markdown view loads is the guarded one", async () => {
  const { result } = renderHook(() => usePlugins({ code: false, mermaid: true, math: false }));

  await waitFor(() => expect(result.current.mermaid).not.toBeUndefined(), { timeout: 10_000 });
  const plugin = result.current.mermaid;

  assert(plugin !== undefined);

  await assert.rejects(
    plugin.getMermaid().render("hover", `flowchart LR\n A@{ "\\x69mg": "${PIXEL}" }`),
    /Diagram not shown/
  );
});
