/**
 * The code highlighter and the diagram renderer, each loaded on first need as its own chunk
 * (Highlights' Wasm and Pele are most of Markdown's weight), then shared by every view.
 * Components subscribe, so a block re-renders when one arrives.
 */
import type { MermaidPlugin } from "@pierre/words/html";
import { useEffect, useSyncExternalStore } from "react";
import type { CodeHighlighter } from "./code/highlighter.ts";

export interface Plugins {
  readonly code?: CodeHighlighter;
  readonly mermaid?: MermaidPlugin;
}

type Name = "code" | "mermaid";

let loaded: Plugins = {};

const loading = new Set<Name>();

const listeners = new Set<() => void>();

const publish = (patch: Partial<Plugins>) => {
  loaded = { ...loaded, ...patch };

  for (const listener of listeners) listener();
};

const LOADERS: Readonly<Record<Name, () => Promise<Partial<Plugins>>>> = {
  code: async () => {
    const { codeHighlighter } = await import("./code/highlighter.ts");

    return { code: codeHighlighter };
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
