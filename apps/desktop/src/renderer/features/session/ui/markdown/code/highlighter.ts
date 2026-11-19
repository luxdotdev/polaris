/**
 * The code highlighter behind every Markdown code block: Shiki on the moonlit tokens
 * (`theme.ts`), shaped as Words' `CodeHighlighterPlugin`. `createCodeHighlighter` is the one
 * function to swap for another highlighter (ENG-971; B2 moves it to the shared highlights theme).
 */
import type { CodeHighlighterPlugin, CodeOptions } from "@pierre/words/html";
import {
  type BundledLanguage,
  bundledLanguagesInfo,
  createHighlighter,
  type ThemedToken,
} from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { POLARIS_SHIKI } from "../theme.ts";

/** Every bundled language by its id and aliases. */
const ALIASES = new Map<string, BundledLanguage>(
  bundledLanguagesInfo.flatMap((info) => {
    // SAFETY: ids in Shiki's own bundled language list are its bundled languages.
    const id = info.id as BundledLanguage;

    return [info.id, ...(info.aliases ?? [])].map((name): [string, BundledLanguage] => [name, id]);
  })
);

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** One line as its own span, so a long block lays out line by line. */
const lineHtml = (tokens: ReadonlyArray<ThemedToken>) =>
  `<span class="line">${tokens
    .map((token) =>
      token.color === undefined
        ? escapeHtml(token.content)
        : `<span style="color:${escapeHtml(token.color)}">${escapeHtml(token.content)}</span>`
    )
    .join("")}</span>`;

const MAX_CACHED = 256;

/** Finished blocks by language and code; the oldest goes first. */
const remember = (cache: Map<string, string>, key: string, html: string) => {
  cache.set(key, html);

  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value ?? key);
};

/**
 * Highlighted HTML for the inside of `<code>`, a line per span; a language Shiki doesn't bundle as
 * plain lines. Null while a language loads; then `onLoad` runs, so views ask again.
 */
export const createCodeHighlighter = async (onLoad: () => void): Promise<CodeHighlighterPlugin> => {
  const shiki = await createHighlighter({
    themes: [POLARIS_SHIKI],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });

  const loading = new Set<string>();
  const finished = new Map<string, string>();

  const ready = (language: string): BundledLanguage | "text" | null => {
    const id = ALIASES.get(language.trim().toLowerCase());

    if (id === undefined) return "text";

    if (shiki.getLoadedLanguages().includes(id)) return id;

    if (!loading.has(id)) {
      loading.add(id);
      void shiki.loadLanguage(id).then(onLoad, () => undefined);
    }

    return null;
  };

  return {
    highlight({ code, language, isIncomplete }: CodeOptions) {
      const lang = ready(language);

      if (lang === null) return null;
      const key = `${lang}\n${code}`;
      const cached = finished.get(key);

      if (cached !== undefined) return cached;

      const lines =
        lang === "text"
          ? code.split("\n").map((content) => [{ content, offset: 0 }])
          : shiki.codeToTokensBase(code, { lang, theme: POLARIS_SHIKI });

      const html = lines.map(lineHtml).join("\n");

      if (!isIncomplete) remember(finished, key, html);

      return html;
    },
  };
};
