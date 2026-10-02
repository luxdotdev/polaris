import type { DiagramPlugin } from "streamdown";

/** Preview diagrams have no resource authority, including Mermaid image nodes or source configuration. */
export const safeDiagramSource = (source: string): boolean =>
  !/%%\s*\{|^\s*---|\b(?:img|icon)["']?\s*:|<(?:img|image|iframe|object|embed|script|style|link|video|audio)\b/im.test(
    source
  );

export const previewDiagrams = (plugin: DiagramPlugin): DiagramPlugin => ({
  ...plugin,
  getMermaid: (config) => {
    const engine = plugin.getMermaid({ ...config, securityLevel: "strict", htmlLabels: false });

    return {
      initialize: (next) =>
        engine.initialize({ ...next, securityLevel: "strict", htmlLabels: false }),
      render: async (id, source) => {
        if (!safeDiagramSource(source))
          throw new Error("Preview diagram contains unsupported configuration or media");

        return engine.render(id, source);
      },
    };
  },
});
