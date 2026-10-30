/** The frame's bootstrap script: the Polaris kit (`pv`), wrapped in one IIFE (see `bootstrapScript`). */
import { FRAME_TOKEN_NAMES, FRAME_TOKEN_VALUE_MAX, UNSAFE_TOKEN_VALUE } from "../../tokens.ts";
import { CHART_JS } from "./chart.ts";
import { CORE_JS } from "./core.ts";
import { FLOW_JS } from "./flow.ts";

export interface BootstrapConfig {
  readonly mode: "inline" | "expanded";
  readonly scheme: "light" | "dark";
  readonly state?: unknown;
}

/** JSON that is safe inside a `<script>`: no `</script>`, `<!--` or line separators survive. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- pv.state is opaque JSON by contract (FrameDocumentOptions.state)
export const scriptJson = (value: unknown): string =>
  (JSON.stringify(value) ?? "null")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");

/**
 * Everything runs inside one IIFE: classic scripts share the global lexical scope, so a top-level
 * `const` here would collide with the agent's own (dcai f030ceca, an agent's `const s`).
 */
export const bootstrapScript = (options: BootstrapConfig): string => {
  const config = {
    names: FRAME_TOKEN_NAMES,
    max: FRAME_TOKEN_VALUE_MAX,
    unsafe: UNSAFE_TOKEN_VALUE.source,
    mode: options.mode,
    hasState: options.state !== undefined,
    state: options.state ?? null,
  };

  return `(function () {
"use strict";
var config = ${scriptJson(config)};
var pv = { scheme: ${scriptJson(options.scheme)} };
${CORE_JS}
${CHART_JS}
${FLOW_JS}
pv.token = token;
pv.palette = palette;
pv.chart = chart;
pv.charts = charts;
pv.bind = bind;
pv.flow = flow;
pv.state = stateApi;
pv.openLink = openLink;
pv.tabs = { select: selectTab };
pv.onTheme = function (listener) { themeListeners.push(listener); };
window.pv = pv;
})();`;
};
