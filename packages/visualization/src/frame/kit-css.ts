/**
 * The frame's base stylesheet and the Polaris kit (`.pv-*`), from DESIGN.md's Visualizations
 * section and Paper V9. Every rule reads only `var(--pv-*)`; restyle the kit here, in one place.
 */
export const KIT_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  background: var(--pv-bg);
  color: var(--pv-text);
  font: 13px/20px var(--pv-font);
  -webkit-font-smoothing: antialiased;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
body { padding: var(--pv-pad); display: flex; flex-direction: column; gap: 14px; }
@media (max-width: 479px) { body { padding: calc(var(--pv-pad) * 0.75); } }
html[data-pv-mode="inline"] { overflow-y: hidden; }
html[data-pv-mode="expanded"], html[data-pv-mode="expanded"] body { min-height: 100%; }
html[data-pv-mode="expanded"] body { padding: calc(var(--pv-pad) * 1.5); gap: 20px; }
h1, h2, h3, h4 { margin: 0; font-size: 15px; line-height: 20px; font-weight: 500; color: var(--pv-text-strong); }
p { margin: 0; max-width: 68ch; }
b, strong { font-weight: 500; color: var(--pv-text-strong); }
code, kbd, pre { font-family: var(--pv-font-mono); font-size: 12px; }
canvas, svg, img { max-width: 100%; }
a, .pv-link { color: var(--pv-text-strong); text-decoration: underline; text-decoration-thickness: 1px; text-decoration-color: var(--pv-border-strong); text-underline-offset: 3px; }
.pv-link { display: inline; padding: 0; border: 0; background: none; font: inherit; cursor: pointer; }
:focus-visible { outline: 2px solid var(--pv-focus); outline-offset: 2px; }
button, input, select { font: inherit; color: inherit; }

.pv-subtle { color: var(--pv-text-subtle); }
.pv-caption { font-size: 12px; line-height: 16px; color: var(--pv-text-subtle); }
.pv-kicker { font: 500 11px/14px var(--pv-font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--pv-text-subtle); }
.pv-num { font-family: var(--pv-font-mono); font-variant-numeric: tabular-nums; }
.pv-stack { display: flex; flex-direction: column; gap: 14px; }
.pv-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pv-gap); }
.pv-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 14px; }
.pv-card { background: var(--pv-surface); border-radius: var(--pv-radius); padding: 12px 14px; }

.pv-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--pv-gap); }
.pv-stat { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 12px 14px; background: var(--pv-surface); border-radius: var(--pv-radius); }
.pv-stat-label { font: 500 11px/14px var(--pv-font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--pv-text-subtle); }
.pv-stat-value { font-size: 22px; line-height: 28px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--pv-text-strong); overflow-wrap: anywhere; }
.pv-stat-sub { font-size: 12px; line-height: 16px; color: var(--pv-text-subtle); }

.pv-slider { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px 12px; }
.pv-slider > :first-child { font-size: 13px; line-height: 18px; color: var(--pv-text); }
.pv-slider output { font: 500 13px/18px var(--pv-font-mono); font-variant-numeric: tabular-nums; color: var(--pv-text-strong); text-align: right; }
.pv-slider input[type="range"] { grid-column: 1 / -1; }
input[type="range"] {
  --pv-fill: 50%;
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 24px;
  margin: 0;
  background: transparent;
  cursor: pointer;
}
input[type="range"]:focus-visible { outline: none; }
input[type="range"]::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(to right, var(--pv-accent) var(--pv-fill), var(--pv-track) var(--pv-fill));
}
input[type="range"]::-moz-range-track { height: 4px; border-radius: 999px; background: var(--pv-track); }
input[type="range"]::-moz-range-progress { height: 4px; border-radius: 999px; background: var(--pv-accent); }
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -6px;
  border: 0;
  border-radius: 50%;
  background: var(--pv-text-strong);
  box-shadow: 0 0 0 3px var(--pv-bg);
}
input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: 50%;
  background: var(--pv-text-strong);
  box-shadow: 0 0 0 3px var(--pv-bg);
}
input[type="range"]:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px var(--pv-bg), 0 0 0 5px var(--pv-focus); }
input[type="range"]:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 3px var(--pv-bg), 0 0 0 5px var(--pv-focus); }

.pv-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--pv-radius-sm);
  font-size: 13px;
  font-weight: 500;
  line-height: 16px;
  color: var(--pv-text);
  background: var(--pv-surface);
  box-shadow: inset 0 0 0 1px var(--pv-border-strong);
  cursor: pointer;
  white-space: nowrap;
}
.pv-button:hover { color: var(--pv-text-strong); }
.pv-button-primary { background: var(--pv-text-strong); color: var(--pv-bg); box-shadow: none; }
.pv-button-primary:hover { color: var(--pv-bg); }
.pv-button-ghost { background: transparent; box-shadow: none; }
.pv-button:disabled { color: var(--pv-text-faint); cursor: default; }

.pv-tabs { display: inline-flex; align-self: flex-start; flex-wrap: wrap; gap: 2px; padding: 3px; border-radius: var(--pv-radius); background: var(--pv-surface); }
.pv-tabs + * { margin-top: 2px; }
.pv-tab, .pv-tabs [role="tab"] {
  height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  font-size: 12px;
  line-height: 16px;
  color: var(--pv-text-subtle);
  cursor: pointer;
}
.pv-tabs [role="tab"]:hover { color: var(--pv-text); }
.pv-tabs [role="tab"][aria-selected="true"] { background: var(--pv-raised); box-shadow: inset 0 0 0 1px var(--pv-border-strong); font-weight: 500; color: var(--pv-text-strong); }
[role="tabpanel"][hidden] { display: none; }

.pv-table-wrap { overflow-x: auto; overflow-y: hidden; border-radius: var(--pv-radius); box-shadow: inset 0 0 0 1px var(--pv-border); }
.pv-table { width: 100%; border-collapse: collapse; }
.pv-table th {
  height: 32px;
  padding: 0 12px;
  background: var(--pv-surface);
  text-align: left;
  font: 500 11px/14px var(--pv-font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--pv-text-subtle);
  white-space: nowrap;
}
.pv-table td { height: 36px; padding: 0 12px; border-top: 1px solid var(--pv-border); font-size: 13px; line-height: 18px; color: var(--pv-text); }
.pv-table :is(th, td).pv-num { text-align: right; }
.pv-table td.pv-num { font-family: var(--pv-font-mono); font-variant-numeric: tabular-nums; }
.pv-table tr.pv-row-on td { background: color-mix(in srgb, var(--pv-text-strong) 2%, transparent); font-weight: 500; color: var(--pv-text-strong); }

.pv-steps { list-style: none; margin: 0; padding: 0; counter-reset: pv-step; }
.pv-steps > li { position: relative; display: grid; grid-template-columns: 20px 1fr; column-gap: 12px; padding-bottom: 14px; counter-increment: pv-step; }
.pv-steps > li:last-child { padding-bottom: 0; }
.pv-steps > li::before {
  content: counter(pv-step);
  grid-row: 1 / span 2;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font: 500 11px/14px var(--pv-font-mono);
  color: var(--pv-text-subtle);
  box-shadow: inset 0 0 0 1px var(--pv-border-strong);
}
.pv-steps > li::after { content: ""; position: absolute; left: 9px; top: 22px; bottom: 2px; width: 2px; border-radius: 1px; background: var(--pv-track); }
.pv-steps > li:last-child::after { display: none; }
.pv-steps > li[data-state="done"]::before { background: var(--pv-surface); }
.pv-steps > li[data-state="done"]::after { background: var(--pv-accent); }
.pv-steps > li[data-state="current"]::before { background: var(--pv-accent); box-shadow: none; color: var(--pv-bg); font-weight: 600; }
.pv-steps > li > * { grid-column: 2; }
.pv-step-title { font-size: 13px; line-height: 20px; color: var(--pv-text); }
.pv-steps > li[data-state="done"] .pv-step-title { color: var(--pv-text-subtle); }
.pv-steps > li[data-state="current"] .pv-step-title { font-weight: 500; color: var(--pv-text-strong); }
.pv-step-detail { grid-column: 2; font-size: 12px; line-height: 16px; color: var(--pv-text-subtle); }

.pv-chart { position: relative; width: 100%; height: 200px; }
html[data-pv-mode="expanded"] .pv-chart { height: clamp(240px, 55vh, 720px); }
.pv-chart > canvas { position: absolute; inset: 0; }

.pv-flow { width: 100%; overflow-x: auto; overflow-y: hidden; }
.pv-flow svg { display: block; }
.pv-flow-node rect { fill: var(--pv-surface); stroke: var(--pv-border-strong); stroke-width: 1; }
.pv-flow-node[data-tone="accent"] rect { fill: var(--pv-accent); stroke: none; }
.pv-flow-node[data-tone="accent"] text { fill: var(--pv-bg); }
.pv-flow-node[data-tone="muted"] rect { fill: transparent; stroke-dasharray: 3 3; }
.pv-flow-node[data-tone="muted"] .pv-flow-label { fill: var(--pv-text-subtle); }
.pv-flow-label { fill: var(--pv-text-strong); font: 500 13px var(--pv-font); }
.pv-flow-detail { fill: var(--pv-text-subtle); font: 12px var(--pv-font); }
.pv-flow-edge { fill: none; stroke: var(--pv-border-strong); stroke-width: 1.5; }
.pv-flow-edge[data-back] { stroke-dasharray: 4 3; }
.pv-flow-arrow { fill: var(--pv-text-subtle); }
.pv-flow-edge-label { fill: var(--pv-text-subtle); font: 11px var(--pv-font-mono); paint-order: stroke; stroke: var(--pv-bg); stroke-width: 4px; stroke-linejoin: round; }

.pv-error { padding: 8px 10px; border-radius: var(--pv-radius-sm); box-shadow: inset 0 0 0 1px var(--pv-border-strong); color: var(--pv-text-subtle); font-size: 12px; line-height: 16px; }

.pv-button, .pv-tabs [role="tab"] { transition: color 120ms, background-color 120ms; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
`;
