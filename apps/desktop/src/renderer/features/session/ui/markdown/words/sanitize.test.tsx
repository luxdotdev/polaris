import "../../../../../test/dom.testing.ts";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markup } from "./Markup.tsx";
import { renderHtml } from "./render.ts";
import { MATH_SCHEMA, PROSE_SCHEMA } from "./schema.ts";

const prose = (markdown: string) =>
  renderToStaticMarkup(
    <Markup
      html={renderHtml(markdown, { html: true, math: false })}
      pipeline={{ schema: PROSE_SCHEMA }}
      components={{}}
    />
  );

const math = (markdown: string) =>
  renderToStaticMarkup(
    <Markup
      html={renderHtml(markdown, { html: false, math: true })}
      pipeline={{ schema: MATH_SCHEMA }}
      components={{}}
    />
  );

describe("raw HTML in a Review or a document", () => {
  test.each([
    ["a script", "<script>globalThis.hacked = 1</script>", /<script/i],
    ["an event handler", '<img src="https://e.com/a.png" onerror="alert(1)">', /onerror/i],
    ["an iframe", '<iframe src="https://e.com"></iframe>', /<iframe/i],
    ["a javascript: link", "[x](javascript:alert(1))", /javascript:/i],
    ["an uppercase JAVASCRIPT: link", '<a href="JAVASCRIPT:alert(1)">x</a>', /javascript:/i],
    ["an entity-encoded javascript: link", '<a href="jav&#x61;script:alert(1)">x</a>', /script:/i],
    ["a data: link", "[x](data:text/html,<script>alert(1)</script>)", /data:/i],
    ["a style attribute", '<p style="background:url(https://e.com/t.png)">x</p>', /style=/i],
    ["a style element", "<style>body{display:none}</style>", /<style/i],
    ["an object", '<object data="https://e.com/x.swf"></object>', /<object/i],
    [
      "a form",
      '<form action="https://e.com"><input type="text"></form>',
      /<form|action=|type="text"/i,
    ],
    ["raw SVG", '<svg><image href="https://e.com/a.png"/></svg>', /<svg|<image/i],
  ])("%s never renders", (_, markdown, forbidden) => {
    expect(prose(markdown)).not.toMatch(forbidden);
  });

  test("ids and names are prefixed, so a document can't clobber the app's elements or globals", () => {
    const html = prose('<div id="root">a</div>\n\n<a name="polaris">b</a>');

    expect(html).toContain('id="user-content-root"');
    expect(html).toContain('name="user-content-polaris"');
    expect(html).not.toMatch(/(?:id|name)="(?:root|polaris)"/);
  });

  test("GitHub's set stays: details, summary, sub, sup, images, task lists, footnotes", () => {
    const html = prose(
      [
        "<details><summary>More</summary>",
        "",
        "H<sub>2</sub>O and x<sup>2</sup> ![shot](https://e.com/a.png)",
        "</details>",
        "",
        "- [x] done",
        "",
        "Note[^1].",
        "",
        "[^1]: The note.",
      ].join("\n")
    );

    expect(html).toContain("<details>");
    expect(html).toContain("<summary>More</summary>");
    expect(html).toContain("<sub>2</sub>");
    expect(html).toContain("<sup>2</sup>");
    expect(html).toContain('src="https://e.com/a.png"');
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).toContain('id="user-content-fn-1"');
  });
});

describe("Markdown with math", () => {
  test("a formula renders as Words' SVG, its layout kept", () => {
    const html = math("$$\\frac{a}{b}$$");

    expect(html).toMatch(/<svg[^>]*role="img"/);
    expect(html).toMatch(/style="display:block;margin:1em auto;overflow:visible"/);
    expect(html).toContain("<text");
  });

  test("raw HTML is skipped, so no SVG but Words' own reaches the page", () => {
    const html = math('<svg onload="alert(1)"><image href="https://e.com/a.png"/></svg> $x$');

    expect(html).not.toMatch(/onload|<image|href=/i);
  });
});
