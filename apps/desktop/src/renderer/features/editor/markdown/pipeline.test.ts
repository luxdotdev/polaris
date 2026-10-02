import { expect, test } from "bun:test";
import { Predicate } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { PREVIEW_REHYPE, SAFE_HTML_COMPONENTS } from "./pipeline.tsx";

test("actual sanitized static GFM passes relative links/images to Host routing", () => {
  const hrefs: Array<string | undefined> = [];
  const sources: Array<string | undefined> = [];

  const html = renderToStaticMarkup(
    createElement(
      Streamdown,
      {
        mode: "static",
        rehypePlugins: PREVIEW_REHYPE,
        components: {
          ...SAFE_HTML_COMPONENTS,
          a: ({ href, children }) => {
            hrefs.push(href);

            return createElement("span", {}, children);
          },
          img: ({ src }) => {
            if (Predicate.isString(src)) sources.push(src);

            return null;
          },
        },
      },
      `# Hello **World**

[Relative guide](guide.md#intro) [Fragment](#hello-world) [Script](javascript:alert(1))

| GFM | table |
| --- | --- |
| works | here |

- [x] task

~~removed~~

<script>compromised()</script><iframe src="https://bad.invalid"></iframe>
<picture><source srcset="https://bad.invalid/bypass.png"><img src="../image.png" onerror="compromised()"></picture>`
    )
  );

  expect(hrefs).toContain("guide.md#intro");
  expect(hrefs).toContain("#hello-world");
  expect(hrefs).not.toContain("javascript:alert(1)");
  expect(sources).toEqual(["../image.png"]);
  expect(html).toContain('id="preview-hello-world"');
  expect(html).toContain("<table");
  expect(html).toContain('type="checkbox"');
  expect(html).toContain("<del");
  expect(html).not.toMatch(/<script|<iframe|<source|srcset=|onerror=/);
});
