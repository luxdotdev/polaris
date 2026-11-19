/**
 * The code highlighter and the diagram renderer, each loaded on first need as its own chunk
 * (Shiki and Pele are most of Markdown's weight), then shared by every view. Components subscribe,
 * so a block re-renders when one arrives or a highlighter language finishes loading.
 */
import type { CodeHighlighterPlugin, MermaidPlugin } from "@pierre/words/html";
import { useEffect, useSyncExternalStore } from "react";

export interface Plugins {
  readonly code?: CodeHighlighterPlugin;
  readonly mermaid?: MermaidPlugin;
  /** Bumps when a highlighter language loads, so highlighted blocks render again. */
  readonly version: number;
}

type Name = "code" | "mermaid";

let loaded: Plugins = { version: 0 };

const loading = new Set<Name>();

const listeners = new Set<() => void>();

const publish = (patch: Partial<Plugins>) => {
  loaded = { ...loaded, ...patch, version: loaded.version + 1 };

  for (const listener of listeners) listener();
};

const LOADERS: Readonly<Record<Name, () => Promise<Partial<Plugins>>>> = {
  code: async () => {
    const { createCodeHighlighter } = await import("./code/highlighter.ts");

    return { code: await createCodeHighlighter(() => publish({})) };
  },
  mermaid: async () => {
    const [pele, { guardedDiagrams }] = await Promise.all([
      import("pele"),
      import("./diagrams.ts"),
    ]);

    return { mermaid: guardedDiagrams(pele) };
  },
};

const load = (name: Name) => {
  if (loading.has(name)) return;
  loading.add(name);
  void LOADERS[name]()
    .then(publish)
    .catch(() => loading.delete(name));
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => listeners.delete(listener);
};

/** The plugins loaded so far; starts loading the ones asked for. */
export const usePlugins = ({
  code,
  mermaid,
}: {
  readonly code: boolean;
  readonly mermaid: boolean;
}): Plugins => {
  useEffect(() => {
    if (code) load("code");

    if (mermaid) load("mermaid");
  }, [code, mermaid]);

  return useSyncExternalStore(subscribe, () => loaded);
};
