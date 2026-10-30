import type { VisualsLevel } from "@polaris/protocol";

const GUIDANCE: Record<VisualsLevel, string> = {
  rich: "Visualizations: when a chart, table, diagram or small interactive page explains something better than prose, show it with the visualize tool.",
  simple:
    "Visualizations: use the visualize tool only when the user asks for a visual or prose can't carry it.",
  off: "",
};

/** PLACEHOLDER until F1 lands `VISUALIZE_TOOL_DESCRIPTION` and `visualizeGuidance(level)`. */
export const visualizeText = () => ({
  description:
    "Show the user a Visualization: an HTML body fragment that renders in the conversation. Inline every value you computed; the frame has no network.",
  guidance: (level: VisualsLevel) => GUIDANCE[level],
});
