/** Local grammars are requested on demand; failed imports leave plain text and can retry. */
import type { Extension } from "@codemirror/state";
import type { LanguageSupport, StreamParser } from "@codemirror/language";
import { LANGUAGES, LANGUAGE_IDS, languageByName, type LanguageId } from "../model/language.ts";

export type GrammarId = Exclude<LanguageId, "plain">;

export type GrammarLoader = () => Promise<LanguageSupport>;

const stream = async (parser: StreamParser<unknown>) => {
  const { LanguageSupport, StreamLanguage } = await import("@codemirror/language");

  return new LanguageSupport(StreamLanguage.define(parser));
};

const js = async (options: { typescript?: boolean; jsx?: boolean }) =>
  (await import("@codemirror/lang-javascript")).javascript(options);

const LOADERS: Readonly<Record<GrammarId, GrammarLoader>> = {
  typescript: () => js({ typescript: true }),
  tsx: () => js({ typescript: true, jsx: true }),
  javascript: () => js({}),
  jsx: () => js({ jsx: true }),
  json: async () => (await import("@codemirror/lang-json")).json(),
  css: async () => (await import("@codemirror/lang-css")).css(),
  html: async () => (await import("@codemirror/lang-html")).html(),
  markdown: async () => {
    const [{ markdown, markdownLanguage }, codeLanguages] = await Promise.all([
      import("@codemirror/lang-markdown"),
      fencedLanguages(),
    ]);

    const byId = new Map(
      codeLanguages.map((description) => [languageByName(description.name), description])
    );

    return markdown({
      base: markdownLanguage,
      codeLanguages: (info) => byId.get(fenceLanguageId(info)) ?? null,
    });
  },
  python: async () => (await import("@codemirror/lang-python")).python(),
  rust: async () => (await import("@codemirror/lang-rust")).rust(),
  go: async () => (await import("@codemirror/lang-go")).go(),
  gomod: async () => (await import("./grammars/go-project.ts")).goProject("gomod"),
  gowork: async () => (await import("./grammars/go-project.ts")).goProject("gowork"),
  yaml: async () => (await import("@codemirror/lang-yaml")).yaml(),
  sql: async () => (await import("@codemirror/lang-sql")).sql(),
  java: async () => (await import("@codemirror/lang-java")).java(),
  php: async () => (await import("@codemirror/lang-php")).php(),
  dotenv: async () => (await import("./grammars/dotenv.ts")).dotenv(),
  prisma: async () => (await import("./grammars/prisma.ts")).prisma(),
  toml: async () => stream((await import("@codemirror/legacy-modes/mode/toml")).toml),
  shell: async () => stream((await import("@codemirror/legacy-modes/mode/shell")).shell),
  lua: async () => stream((await import("@codemirror/legacy-modes/mode/lua")).lua),
  c: async () => stream((await import("@codemirror/legacy-modes/mode/clike")).c),
  cpp: async () => stream((await import("@codemirror/legacy-modes/mode/clike")).cpp),
  csharp: async () => stream((await import("@codemirror/legacy-modes/mode/clike")).csharp),
  ruby: async () => stream((await import("@codemirror/legacy-modes/mode/ruby")).ruby),
  xml: async () => stream((await import("@codemirror/legacy-modes/mode/xml")).xml),
  dockerfile: async () =>
    stream((await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile),
  ini: async () => stream((await import("@codemirror/legacy-modes/mode/properties")).properties),
  diff: async () => stream((await import("@codemirror/legacy-modes/mode/diff")).diff),
};

/** Deduplicates concurrent requests, evicting failures so another request can retry. */
export const createGrammarLoader = (loaders: Readonly<Record<GrammarId, GrammarLoader>>) => {
  const loaded = new Map<GrammarId, Promise<LanguageSupport | null>>();

  return (id: GrammarId): Promise<LanguageSupport | null> => {
    const cached = loaded.get(id);

    if (cached !== undefined) return cached;

    const promise = Promise.resolve()
      .then(loaders[id])
      .catch((cause: unknown) => {
        console.warn(`polaris: the ${id} grammar didn't load`, cause);
        loaded.delete(id);

        return null;
      });

    loaded.set(id, promise);

    return promise;
  };
};

const grammar = createGrammarLoader(LOADERS);

export const loadLanguage = async (id: LanguageId): Promise<Extension> =>
  id === "plain" ? [] : ((await grammar(id)) ?? []);

/** Descriptions are cheap; Markdown loads only grammars named by encountered fences. */
export const fencedLanguages = async () => {
  const { LanguageDescription } = await import("@codemirror/language");

  return LANGUAGE_IDS.filter((id): id is GrammarId => id !== "plain" && id !== "markdown").map(
    (id) =>
      LanguageDescription.of({
        name: LANGUAGES[id].name,
        alias: [id, ...LANGUAGES[id].aliases],
        extensions: [...LANGUAGES[id].extensions],
        load: async () => {
          const support = await grammar(id);

          // A rejected description resets its pending load, allowing a later parse to retry.
          if (support === null) throw new Error(`polaris: unavailable ${id} fence grammar`);

          return support;
        },
      })
  );
};

/** The first info word is the language; trailing Markdown fence metadata is ignored. */
export const fenceLanguageId = (info: string) =>
  languageByName(info.trim().split(/\s+/, 1)[0] ?? "");
