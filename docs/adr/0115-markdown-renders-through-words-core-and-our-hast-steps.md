---
status: accepted (ENG-971)
---

# Markdown renders through Words' core and our own hast steps

## Context

The Desktop App rendered Markdown (the transcript, the Editor's preview, language-server hovers,
the Review overview) with Streamdown: remark and rehype, KaTeX for math and Mermaid for diagrams.
ENG-971 moves it to `@pierre/words`, a WebAssembly Markdown renderer with TeX-to-SVG math, and
to Pele for Mermaid diagrams.

Words ships a React component, `<Markdown>`. It owns its DOM: it patches the nodes in place on
each update, and its hooks (`components`) rewrite HTML strings rather than return React elements.
Two things in Polaris don't fit:

- **Our pieces are React components.** Links open the editor (`FileLink`), a Host path
  (`HostLink`) or the session's Browser (`BrowserLink`); images named by a path are read from the
  Host (`HostImage`, the image viewer); code and tables copy through the shared `CopyButton`; the
  Review's links come from `renderLink`. React can't own nodes inside DOM another renderer patches,
  and any hook turns off the component's fast append path anyway.
- **The component omits raw HTML.** Review descriptions and bot summaries rely on `<details>`,
  `<sub>`, `<img>`; README previews on HTML blocks.

## Decision

- **Words' core renders the HTML.** A streamed message uses a `createHtmlSession`: finished blocks
  keep their HTML and only the open end is reparsed. Static views (Review, Editor preview, hovers)
  use `renderToHtml`, with raw HTML where the view had it before.
- **Our pipeline turns it into React.** The HTML is parsed in an inert `<template>`, converted to
  hast (`hast-util-from-dom`), always sanitized with an explicit `hast-util-sanitize` schema
  (`words/schema.ts`), passed through the view's existing hast steps (file links, Host images and
  links, soft breaks, `rehypeReview`, preview headings), and rendered with `hast-util-to-jsx-runtime`
  and our components (`words/Markup.tsx`). Sanitizing is a required part of the pipeline, on
  every path, the transcript included.
- **One block per React key.** A streamed message renders each top-level block as its own memoised
  `Markup`, keyed by its position, so finished blocks never re-render and the open end settles in
  place. Our own CSS caret marks the open end: steady, since only the Working dither loops (DESIGN.md).
- **One code block.** Every view draws fences with `code/CodeBlock.tsx`; highlighting sits behind
  `createCodeHighlighter` (Shiki today, shaped as Words' `CodeHighlighterPlugin`) so it can be
  swapped. Mermaid fences go through Words' `createMermaidPlugin` over Pele, with no images or
  links and the SVG checked to load nothing; a fence that doesn't parse shows as code.
- **Math.** `\(…\)` and `\[…\]` become Words' `$…$` and `$$…$$`; a lone `$` stays a dollar, as
  under Streamdown. Words exposes no parse tree, so Words decides what is prose: each delimiter is
  swapped for a marker, the text rendered as it will be (math off), and only markers that come out
  as parsed prose text change; code, links, autolinks, raw HTML and attributes stay as written.

## Consequences

- Per-chunk render time of a 7.5 KB streamed answer in 24-character chunks (happy-dom, the
  `streamTiming` harness): p50 0.24 ms, p95 0.85 ms, against Streamdown's 0.88 ms and 2.1 ms.
- Words' own fade-in and caret, and its DOM patching, are not used. Raw HTML in a streamed message
  is dropped by the session (it was sanitized and shown before); Review and Preview keep it.
- Pele's SVG does not pass through the hast sanitizer: it is rendered as trusted HTML once
  `guardedDiagrams` has checked it loads and links nothing. Its labels stay inert only because the
  pinned Pele escapes them, so any Pele upgrade must re-run the hostile-label tests in
  `session/ui/markdown/diagrams.test.ts` before it lands.
- Ids and names get a per-document prefix (`user-content-<scope>-`), so a document can't clobber the
  app's elements, its globals or another message's footnotes; same-document links (footnotes) are rewritten to match and scroll
  within their message.
- Words is WebAssembly, so the renderer's CSP adds `'wasm-unsafe-eval'` to `script-src`
  (`src/main/protocol.ts`): it allows compiling WebAssembly, not JavaScript `eval`.
- `hast-util-from-dom`, `hast-util-sanitize` and `hast-util-to-jsx-runtime` are direct, pinned
  dependencies; KaTeX, Mermaid and Streamdown are gone.
