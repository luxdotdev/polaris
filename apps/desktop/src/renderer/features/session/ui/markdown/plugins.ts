/**
 * Streamdown's plugins, each loaded on first need as its own chunk (Shiki,
 * Mermaid and KaTeX are most of Markdown's weight), then shared by every
 * message. Components subscribe so a message re-renders when one arrives.
 */
import type { PluginConfig } from "streamdown";
import { useEffect, useSyncExternalStore } from "react";
import type { Needs } from "./needs.ts";

type Name = keyof Needs;

let loaded: PluginConfig = {};

const loading = new Set<Name>();

const listeners = new Set<() => void>();

const publish = (patch: PluginConfig) => {
  loaded = { ...loaded, ...patch };

  for (const listener of listeners) listener();
};

const LOADERS: Readonly<Record<Name, () => Promise<PluginConfig>>> = {
  code: async () => {
    // Its themes come from Streamdown's `shikiTheme` (`Streamed.tsx`).
    const { code } = await import("@streamdown/code");

    return { code };
  },
  mermaid: async () => {
    const { mermaid } = await import("@streamdown/mermaid");

    return { mermaid };
  },
  math: async () => {
    const [{ createMathPlugin }] = await Promise.all([
      import("@streamdown/math"),
      import("katex/dist/katex.min.css"),
    ]);

    return { math: createMathPlugin({ errorColor: "var(--color-text-subtle)" }) };
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

/** The plugins loaded so far; starts loading the ones `needs` asks for. */
export const usePlugins = ({ code, mermaid, math }: Needs): PluginConfig => {
  useEffect(() => {
    if (code) load("code");

    if (mermaid) load("mermaid");

    if (math) load("math");
  }, [code, mermaid, math]);

  return useSyncExternalStore(subscribe, () => loaded);
};
