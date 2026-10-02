/**
 * Lezer grammars, each its own chunk, fetched the first time a file needs it
 * (spec §4); TOML and shell come from the legacy stream modes. A grammar that
 * fails to load leaves the file in plain text.
 */
import type { Extension } from "@codemirror/state";
import type { LanguageId } from "../model/language.ts";

type Loader = () => Promise<Extension>;

const legacy = async (pick: "toml" | "shell"): Promise<Extension> => {
  const { StreamLanguage } = await import("@codemirror/language");

  if (pick === "toml") {
    const { toml } = await import("@codemirror/legacy-modes/mode/toml");

    return StreamLanguage.define(toml);
  }

  const { shell } = await import("@codemirror/legacy-modes/mode/shell");

  return StreamLanguage.define(shell);
};

const js = async (options: { typescript?: boolean; jsx?: boolean }) =>
  (await import("@codemirror/lang-javascript")).javascript(options);

const LOADERS: Readonly<Record<Exclude<LanguageId, "plain">, Loader>> = {
  typescript: () => js({ typescript: true }),
  tsx: () => js({ typescript: true, jsx: true }),
  javascript: () => js({}),
  jsx: () => js({ jsx: true }),
  json: async () => (await import("@codemirror/lang-json")).json(),
  css: async () => (await import("@codemirror/lang-css")).css(),
  html: async () => (await import("@codemirror/lang-html")).html(),
  markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
  python: async () => (await import("@codemirror/lang-python")).python(),
  rust: async () => (await import("@codemirror/lang-rust")).rust(),
  go: async () => (await import("@codemirror/lang-go")).go(),
  yaml: async () => (await import("@codemirror/lang-yaml")).yaml(),
  toml: () => legacy("toml"),
  sql: async () => (await import("@codemirror/lang-sql")).sql(),
  shell: () => legacy("shell"),
};

const loaded = new Map<LanguageId, Promise<Extension>>();

export const loadLanguage = (id: LanguageId): Promise<Extension> => {
  if (id === "plain") return Promise.resolve([]);
  const cached = loaded.get(id);

  if (cached !== undefined) return cached;

  const promise = LOADERS[id]().catch((cause: unknown) => {
    console.warn(`polaris: the ${id} grammar didn't load`, cause);
    loaded.delete(id);

    return [];
  });

  loaded.set(id, promise);

  return promise;
};
