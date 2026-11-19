# features/highlight

Syntax highlighting outside the Editor, on [`@pierre/highlights`](https://diffs.com/docs#highlights), in the Editor's colours (ENG-972). Review diffs use it through Pierre (`features/diffs`); Markdown code and inline edits call it directly. The Editor itself stays on Lezer.

## The theme

`theme.ts` maps every Highlights token type (Zed scopes such as `keyword.control`, `string.regex`, `function.method`) onto one of the Editor's syntax roles, `SYNTAX` in `editor/cm/theme.ts`. That table is the single source of truth: the Editor's `HighlightStyle` and this theme both read the `--color-*` token names from it, so no colour is written twice.

The theme is a CSS palette (`cssVariables: { prefix: "--color-" }`): a span's colour is `var(--color-syntax-keyword)`, never a hex value. The tokens switch with the app through `light-dark()`, so a change of appearance never highlights again. `HIGHLIGHT_THEMES.moonlit` (dark) and `HIGHLIGHT_THEMES.light` share the palette and differ only in `appearance`, which sets the colour scheme where it matters (Pierre's shadow root). `themeFor(useThemeType())` picks one.

## API

```ts
import { CodeStream, highlightToHtml, themeFor } from "../highlight/index.ts";

// Whole code: a `<pre class="highlights"><code>…</code></pre>` string.
const html = highlightToHtml(code, "ts", themeFor(type));

// Code that grows (a streamed fence): pass the whole text each time.
const stream = new CodeStream("ts", "moonlit");
const { lines, tail } = stream.update(textSoFar); // completed lines as HTML, unfinished line as text
stream.end(finalText); // the last line too
stream.dispose(); // when the block goes
```

- `highlightToHtml(code, lang, theme)`: `lang` is a name or alias (`ts`, `typescript`, `py`…); anything unknown, or empty, draws as plain text. Highlights writes its answer into Wasm memory that the next call overwrites; this decodes it to a string first, so the result is yours to keep.
- `CodeStream`: wraps Highlights' `StreamTokenizer`. Each `update` tokenizes only what's new, keeps lexer state across chunks (a comment opened on one line colours the next), and returns every completed line. Text that no longer starts with what it saw (an edited message) starts over. The `<pre>`, background and line breaks are the caller's.
- Markdown code blocks (`session/ui/markdown/code`) use `CodeStream` while a fence streams and whole-code tokens once it closes; both give the same line HTML, so finishing a fence leaves its lines' DOM in place. A tail ending in a CR whose LF hasn't arrived is drawn without it.
- `lineToHtml(tokens)`: one line of Highlights tokens as escaped spans.
- `highlightLanguage(lang)`: the `Lang` Highlights uses for a name, or `"text"`.

The background in `highlightToHtml`'s `<pre>` is `--color-panel`, the Editor's; override it in CSS where a block sits on another surface.

## Pierre

Pierre's diffs register the same theme (`features/diffs/theme.ts`, `registerDiffThemes`) with the background `--polaris-diff-bg`, and highlight with `preferredHighlighter: "highlights"`, in the worker pool and on the main thread. `@pierre/diffs` 1.6.4 bundles its own `@pierre/highlights` (0.4.0) for that; this module pins 0.5.1. The theme is plain data both read.
