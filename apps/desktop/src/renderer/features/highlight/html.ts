/**
 * Whole code to HTML in one call. Highlights answers with bytes in Wasm memory that the next
 * call overwrites, so they're decoded here before anything else can highlight.
 */
import { codeToHtml, isSupportedLanguage, type Lang } from "@pierre/highlights";
import { HIGHLIGHT_THEMES, type HighlightTheme } from "./theme.ts";

const decoder = new TextDecoder();

/** `lang` if Highlights has a lexer for it (a name or alias such as `ts`), else plain text. */
export const highlightLanguage = (lang: string | null | undefined): Lang => {
  const name = lang?.trim().toLowerCase() ?? "";

  return name !== "" && isSupportedLanguage(name) ? name : "text";
};

/** `code` as a `<pre class="highlights"><code>` fragment coloured by the Editor's tokens. */
export const highlightToHtml = (code: string, lang: string, theme: HighlightTheme): string =>
  decoder.decode(
    codeToHtml(code, { lang: highlightLanguage(lang), theme: HIGHLIGHT_THEMES[theme] })
  );
