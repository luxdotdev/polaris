/**
 * `pv.chart`, as script text: Chart.js with the kit's defaults (V9) from the frame tokens,
 * re-themed on `pv:theme`. Datasets without their own colours take the series in order.
 */
export const CHART_JS = String.raw`
var painted = typeof WeakSet === "function" ? new WeakSet() : null;
var charts = [];

function palette() {
  var colours = [];
  for (var i = 1; i <= 5; i++) colours.push(token("series-" + i));
  return colours;
}

function withAlpha(colour, alpha) {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) return colour;
  return colour + Math.round(alpha * 255).toString(16).padStart(2, "0");
}

var CATEGORICAL = { pie: true, doughnut: true, polarArea: true };

function paintDataset(dataset, index, type, colours) {
  if (CATEGORICAL[type]) {
    var count = Array.isArray(dataset.data) ? dataset.data.length : 0;
    var fills = [];
    for (var i = 0; i < count; i++) fills.push(colours[i % colours.length]);
    dataset.backgroundColor = fills;
    dataset.borderColor = token("bg");
    return;
  }
  var colour = colours[index % colours.length];
  dataset.borderColor = colour;
  dataset.backgroundColor = dataset.fill ? withAlpha(colour, 0.16) : colour;
  if (type === "line" || type === "radar") {
    dataset.pointHoverBackgroundColor = token("text-strong");
    dataset.pointHoverBorderColor = token("bg");
  }
}

function paint(chart) {
  if (!painted) return;
  var colours = palette();
  var type = chart.config.type;
  chart.data.datasets.forEach(function (dataset, index) {
    var own = dataset.backgroundColor !== undefined || dataset.borderColor !== undefined;
    if (own && !painted.has(dataset)) return;
    paintDataset(dataset, index, dataset.type || type, colours);
    painted.add(dataset);
  });
}

function themeChartDefaults() {
  if (typeof Chart === "undefined") return;
  var d = Chart.defaults;
  var mono = { family: token("font-mono"), size: 10 };
  d.font.family = token("font");
  d.font.size = 12;
  d.color = token("text-subtle");
  d.borderColor = token("border");
  d.animation = false;
  d.elements.line.borderWidth = 2;
  d.elements.line.tension = 0.3;
  d.elements.point.radius = 0;
  d.elements.point.hoverRadius = 4;
  d.elements.point.hoverBorderWidth = 2;
  d.elements.bar.borderRadius = 4;
  d.datasets.bar.categoryPercentage = 0.7;
  d.datasets.bar.barPercentage = 1;
  d.scale.grid.color = token("border");
  d.scale.border.display = false;
  d.scale.ticks.font = mono;
  d.scale.ticks.color = token("text-subtle");
  d.scale.ticks.maxTicksLimit = 5;
  d.plugins.legend.position = "top";
  d.plugins.legend.align = "start";
  d.plugins.legend.labels.boxWidth = 8;
  d.plugins.legend.labels.boxHeight = 8;
  d.plugins.legend.labels.useBorderRadius = true;
  d.plugins.legend.labels.borderRadius = 2;
  d.plugins.legend.labels.padding = 14;
  var tip = d.plugins.tooltip;
  tip.backgroundColor = token("raised");
  tip.borderColor = token("border-strong");
  tip.borderWidth = 1;
  tip.cornerRadius = 8;
  tip.titleColor = token("text-subtle");
  tip.titleFont = { family: token("font-mono"), size: 11, weight: "500" };
  tip.bodyColor = token("text");
  tip.footerColor = token("text-subtle");
  tip.boxPadding = 4;
  d.interaction.mode = "index";
  d.interaction.intersect = false;
}

if (typeof Chart !== "undefined") {
  themeChartDefaults();
  Chart.register({ id: "pvTheme", beforeUpdate: paint });
  themeListeners.push(function () {
    themeChartDefaults();
    charts.forEach(function (chart) { if (chart.canvas) chart.update("none"); });
  });
}

function chartCanvas(target) {
  var el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) throw new Error("pv.chart: no element " + target);
  if (el.tagName === "CANVAS") {
    var parent = el.parentElement;
    if (parent && parent.clientHeight === 0) parent.classList.add("pv-chart");
    if (parent && getComputedStyle(parent).position === "static") parent.style.position = "relative";
    return el;
  }
  el.classList.add("pv-chart");
  var canvas = document.createElement("canvas");
  el.appendChild(canvas);
  return canvas;
}

function chart(target, chartConfig) {
  if (typeof Chart === "undefined") throw new Error("pv.chart: Chart.js is not loaded");
  var options = Object.assign({ responsive: true }, chartConfig.options, { maintainAspectRatio: false });
  var instance = new Chart(chartCanvas(target), Object.assign({}, chartConfig, { options: options }));
  charts.push(instance);
  return instance;
}
`;
