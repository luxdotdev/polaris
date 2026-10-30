/** What the agent is told about `visualize`: the tool description and the per-level guidance. */

/** The tool's description, kept short: the reference lives in `visualizeGuidance`. */
export const VISUALIZE_TOOL_DESCRIPTION = [
  "Show an interactive Visualization inline in the conversation: an HTML fragment (<style>, markup, <script>; no doctype, <html>, <head> or <body>) that runs in a sandboxed frame.",
  "Use it when structure beats prose: comparisons, processes and flows, timelines, architecture, or anything with a knob to turn.",
  "The frame has no network: inline all data as computed values. Chart.js (Chart), D3 (d3) and the Polaris kit (pv) are preloaded; style with the kit's classes and var(--pv-*) tokens.",
  "Nothing in the frame can message you. To revise one, pass `replaces` with the earlier result's id. Keep it under 128 KiB.",
].join(" ");

const RICH = `Reach for visualize whenever structure beats prose, whenever a picture explains better than text: a comparison or trade-off across options, a process or flow, a plan as steps, a timeline, an architecture explanation, a chart of numbers, or anything with a knob the user would want to turn (a rate, a threshold, an assumption) as a slider. Use text when a sentence or a short list says it. The reply's prose must stand alone: say the answer in words, and let the Visualization show it.`;

const SIMPLE = `Use visualize only when asked, or when the answer is a chart or a table. Otherwise answer in text, even for a comparison or a process. The reply's prose must stand alone.`;

const CONTRACT = `## The frame
- Zero egress: no CDNs, fetch, external images, fonts or links. Inline every value you computed (never estimates); images are data: URIs. The submission is refused with a fix if it reaches out.
- A body fragment only: <style>, markup and <script>. Polaris supplies the document, the theme and the libraries. Chart.js (global Chart), D3 v7 (global d3) and the kit (pv) are already loaded; never add a <script src>.
- Nothing in the frame can message you or the conversation, so never render "ask the agent" buttons. pv.openLink(url) offers the user an https page, after they confirm.
- To revise, call visualize again with replaces set to the earlier result's id; the new one takes its place.

## Layout
- The reply is ~728px wide on desktop and ~360px on a phone: design for both (wrap with flex or grid, no fixed widths over 320px).
- No page background, outer card, border or padding around the whole thing: the frame supplies them.
- The frame grows to fit the content. Never use vh/dvh/svh units or height: 100% on html or body; give charts a fixed-height container (160-240px).
- Lead with the result (headline figures), then inputs, then detail. Label every input and show each slider's value.

## Theme
The kit's classes already follow the user's light or dark theme; use them before writing CSS, and never hard-code a colour. For your own CSS use var(--pv-text) body text, var(--pv-text-strong) values and titles, var(--pv-text-subtle) labels and axes, var(--pv-surface) tiles, var(--pv-raised), var(--pv-border) hairlines, var(--pv-border-strong) outlines, var(--pv-accent) the one emphasis, var(--pv-series-1) to var(--pv-series-5) data in order, var(--pv-font), var(--pv-font-mono), var(--pv-radius), var(--pv-gap). Colour is only for data series: no red or green for good and bad (write "was 55 min"), no shadows or gradients. Headings at most 15px; two weights, 400 and 500.`;

const KIT = `## The kit
CSS classes:
- .pv-stats > .pv-stat > .pv-stat-label, .pv-stat-value, .pv-stat-sub: headline figures in tiles.
- <label class="pv-slider"><span>Rate</span><output></output><input type="range" id="rate" data-suffix="%"></label>: a slider with its label and live value (pv.bind fills the output; data-prefix and data-suffix wrap it).
- <div class="pv-tabs" role="tablist"><button role="tab" aria-selected="true" aria-controls="a">A</button>...</div> then <div role="tabpanel" id="a">: 2 to 5 tabs that switch themselves and are remembered; listen for the pv:tab event to draw a panel's chart when it first shows.
- <div class="pv-table-wrap"><table class="pv-table">: a table; .pv-num on th and td right-aligns figures in mono; tr.pv-row-on highlights a row.
- <ol class="pv-steps"><li data-state="done|current"><div class="pv-step-title">...</div><div class="pv-step-detail">...</div></li></ol>: steps or a timeline.
- .pv-card (a surface block), .pv-link (a button that looks like a link), .pv-button, .pv-button-primary, .pv-button-ghost, .pv-grid, .pv-row, .pv-stack, .pv-kicker, .pv-caption, .pv-subtle, .pv-num.
The body is already a column with 14px between blocks: no outer wrapper needed.

Script helpers:
- pv.chart(el, config): a Chart.js chart in el (a container, which gets a 200px box; set its height between 160 and 240px to change it). Datasets without colours take the series in order, the legend sits above, and it follows theme changes. Returns the Chart; to recompute, change chart.data and call chart.update("none").
- pv.bind(inputs, update): inputs is a selector, an element or a list. update(values) runs once now and on every input; values is keyed by each input's name or id (numbers for range and number inputs).
- pv.flow(el, { nodes: [{ id, label, detail?, tone? }], edges: [{ from, to, label? }] }): a flow chart or DAG laid out left to right on desktop and top to bottom on a phone. tone is accent (one node at most) or muted. Returns { update(spec) }.
- pv.state.get() / pv.state.set(value): a JSON value kept for this Visualization on this device and restored when it is shown again (get() is undefined the first time).
- pv.openLink(url): offers an https link to the user, who confirms; returns false for anything else. Never write <a href="https://..."> (it is refused); use <button class="pv-link" onclick="pv.openLink('https://...')">Docs</button>. In-page #id links are fine.
- pv.token("series-1") reads a token's current value; pv.onTheme(fn) runs fn after the theme changes.

## Shape
<div class="pv-stats"><div class="pv-stat"><div class="pv-stat-label">Monthly payment</div><div class="pv-stat-value" id="pay">-</div></div></div>
<label class="pv-slider"><span>Rate</span><output></output><input type="range" id="rate" min="2" max="9" step="0.25" value="6.5" data-suffix="%"></label>
<div id="chart"></div>
<script>
  const DATA = [/* computed values */];
  const chart = pv.chart("#chart", { type: "line", data: { labels: [], datasets: [{ label: "Balance", data: [] }] } });
  pv.bind("#rate", (v) => { /* recompute from v.rate, then update #pay and chart */ chart.update("none"); });
</script>`;

const LEVEL_TEXT = { rich: RICH, simple: SIMPLE } as const;

/** The system-prompt guidance for a Visuals level; `off` has none (the tool is removed). */
export const visualizeGuidance = (level: "rich" | "simple" | "off"): string =>
  level === "off" ? "" : `# Visualizations\n${LEVEL_TEXT[level]}\n\n${CONTRACT}\n\n${KIT}`;
