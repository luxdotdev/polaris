/**
 * `pv.flow`, as script text: a layered DAG layout drawn with D3. Left to right when the columns
 * fit (~728px), top to bottom when they don't (~360px); cycles are drawn as dashed back edges.
 * Tones: `accent` (the one node to look at) and `muted`; no signal colours (V9).
 */
export const FLOW_JS = String.raw`
var flowCount = 0;

function flowLayers(nodes, edges) {
  var index = Object.create(null);
  nodes.forEach(function (node, i) { index[node.id] = i; });
  var valid = edges.filter(function (edge) {
    return index[edge.from] !== undefined && index[edge.to] !== undefined && edge.from !== edge.to;
  });
  var out = nodes.map(function () { return []; });
  valid.forEach(function (edge) { out[index[edge.from]].push(index[edge.to]); });
  var seen = nodes.map(function () { return 0; });
  var back = Object.create(null);
  function visit(i) {
    seen[i] = 1;
    out[i].forEach(function (j) {
      if (seen[j] === 1) back[i + ">" + j] = true;
      else if (seen[j] === 0) visit(j);
    });
    seen[i] = 2;
  }
  nodes.forEach(function (_, i) { if (seen[i] === 0) visit(i); });
  var forward = [];
  var preds = nodes.map(function () { return []; });
  var succs = nodes.map(function () { return []; });
  var indegree = nodes.map(function () { return 0; });
  valid.forEach(function (edge) {
    var a = index[edge.from], b = index[edge.to];
    edge.back = !!back[a + ">" + b];
    if (edge.back) return;
    forward.push(edge);
    preds[b].push(a);
    succs[a].push(b);
    indegree[b]++;
  });
  var rank = nodes.map(function () { return 0; });
  var queue = [];
  indegree.forEach(function (d, i) { if (d === 0) queue.push(i); });
  while (queue.length) {
    var i = queue.shift();
    succs[i].forEach(function (j) {
      rank[j] = Math.max(rank[j], rank[i] + 1);
      if (--indegree[j] === 0) queue.push(j);
    });
  }
  var layers = [];
  rank.forEach(function (r, i) { (layers[r] = layers[r] || []).push(i); });
  layers = layers.filter(Boolean);
  var pos = [];
  function place() { layers.forEach(function (layer) { layer.forEach(function (n, k) { pos[n] = k; }); }); }
  function barycenter(n, neighbours) {
    var list = neighbours[n];
    if (!list.length) return pos[n];
    return list.reduce(function (sum, m) { return sum + pos[m]; }, 0) / list.length;
  }
  place();
  for (var sweep = 0; sweep < 4; sweep++) {
    var down = sweep % 2 === 0;
    for (var r = down ? 1 : layers.length - 2; down ? r < layers.length : r >= 0; r += down ? 1 : -1) {
      var keyed = layers[r].map(function (n) { return [n, barycenter(n, down ? preds : succs)]; });
      keyed.sort(function (a, b) { return a[1] - b[1]; });
      layers[r] = keyed.map(function (pair) { return pair[0]; });
      place();
    }
  }
  return { layers: layers, rank: rank, index: index, edges: valid };
}

function clip(text, width, px) {
  var max = Math.max(4, Math.floor(width / px));
  text = String(text == null ? "" : text);
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

function flowGeometry(layout, nodes, width) {
  var labelled = layout.edges.some(function (edge) { return edge.label && !edge.back; });
  var gap = labelled ? 64 : 32;
  var hasDetail = nodes.some(function (node) { return node.detail; });
  var nodeH = hasDetail ? 50 : 34;
  var count = layout.layers.length;
  var widest = layout.layers.reduce(function (m, layer) { return Math.max(m, layer.length); }, 1);
  var columnW = Math.min(200, (width - (count - 1) * gap) / count);
  var vertical = columnW < 136;
  var boxes = [];
  if (!vertical) {
    var tallest = widest * nodeH + (widest - 1) * 14;
    var offsetX = Math.max(0, (width - (count * columnW + (count - 1) * gap)) / 2);
    layout.layers.forEach(function (layer, r) {
      var top = (tallest - (layer.length * nodeH + (layer.length - 1) * 14)) / 2;
      layer.forEach(function (n, k) {
        boxes[n] = { x: offsetX + r * (columnW + gap), y: top + k * (nodeH + 14), w: columnW, h: nodeH };
      });
    });
    return { boxes: boxes, vertical: false, width: Math.max(width, count * columnW), height: tallest };
  }
  // Back edges run up a gutter on the right, wide enough for their labels.
  var backLabel = layout.edges.reduce(function (m, edge) {
    return edge.back ? Math.max(m, edge.label ? Math.min(120, String(edge.label).length * 6.6) : 0) : m;
  }, -1);
  var gutter = backLabel < 0 ? 0 : 24 + backLabel;
  width = Math.max(120, width - gutter);
  var nodeW = Math.max(84, Math.min(220, (width - (widest - 1) * 12) / widest));
  var rowGap = labelled ? 40 : 30;
  var contentW = Math.max(width, widest * nodeW + (widest - 1) * 12);
  layout.layers.forEach(function (layer, r) {
    var left = (contentW - (layer.length * nodeW + (layer.length - 1) * 12)) / 2;
    layer.forEach(function (n, k) {
      boxes[n] = { x: left + k * (nodeW + 12), y: r * (nodeH + rowGap), w: nodeW, h: nodeH };
    });
  });
  return { boxes: boxes, vertical: true, width: contentW + gutter, height: count * nodeH + (count - 1) * rowGap, right: contentW };
}

function backPath(a, b, geometry) {
  // A back edge runs outside the layout so it never crosses a node: right of it, or below it.
  if (geometry.vertical) {
    var x = geometry.right + 14;
    return "M" + (a.x + a.w) + "," + (a.y + a.h / 2) + " H" + x + " V" + (b.y + b.h / 2) + " H" + (b.x + b.w + 2);
  }
  var y = geometry.height + 10;
  return "M" + (a.x + a.w / 2) + "," + (a.y + a.h) + " V" + y + " H" + (b.x + b.w / 2) + " V" + (b.y + b.h + 2);
}

function edgePath(a, b, geometry) {
  var link = geometry.vertical ? d3.linkVertical() : d3.linkHorizontal();
  return geometry.vertical
    ? link({ source: [a.x + a.w / 2, a.y + a.h], target: [b.x + b.w / 2, b.y - 2] })
    : link({ source: [a.x + a.w, a.y + a.h / 2], target: [b.x - 2, b.y + b.h / 2] });
}

function drawFlow(el, spec, layout, marker) {
  var nodes = spec.nodes;
  var pad = 6;
  var geometry = flowGeometry(layout, nodes, (el.clientWidth || 360) - pad * 2);
  var hasBack = layout.edges.some(function (edge) { return edge.back; });
  d3.select(el).selectAll("svg").remove();
  var svg = d3.select(el).append("svg")
    .attr("width", geometry.width + pad * 2)
    .attr("height", geometry.height + pad * 2 + (hasBack && !geometry.vertical ? 16 : 0))
    .attr("role", "img")
    .attr("aria-label", spec.label || "Flow chart: " + nodes.map(function (n) { return n.label; }).join(", "));
  svg.append("defs").append("marker")
    .attr("id", marker).attr("viewBox", "0 0 8 8").attr("refX", 7).attr("refY", 4)
    .attr("markerWidth", 7).attr("markerHeight", 7).attr("orient", "auto-start-reverse")
    .append("path").attr("class", "pv-flow-arrow").attr("d", "M0,0 L8,4 L0,8 z");
  var g = svg.append("g").attr("transform", "translate(" + pad + "," + pad + ")");
  layout.edges.forEach(function (edge) {
    var a = geometry.boxes[layout.index[edge.from]], b = geometry.boxes[layout.index[edge.to]];
    var path = g.append("path").attr("class", "pv-flow-edge")
      .attr("d", edge.back ? backPath(a, b, geometry) : edgePath(a, b, geometry))
      .attr("marker-end", "url(#" + marker + ")");
    if (edge.back) path.attr("data-back", "");
    if (!edge.label) return;
    var node = path.node();
    var mid = node.getPointAtLength ? node.getPointAtLength(node.getTotalLength() / 2) : { x: 0, y: 0 };
    var side = edge.back && geometry.vertical;
    g.append("text").attr("class", "pv-flow-edge-label")
      .attr("x", side ? mid.x + 6 : mid.x).attr("y", mid.y + 4)
      .attr("text-anchor", side ? "start" : "middle").text(clip(edge.label, 120, 6));
  });
  nodes.forEach(function (node, i) {
    var box = geometry.boxes[i];
    if (!box) return;
    var group = g.append("g").attr("class", "pv-flow-node")
      .attr("data-tone", node.tone || "default")
      .attr("transform", "translate(" + box.x + "," + box.y + ")");
    group.append("title").text(node.detail ? node.label + " — " + node.detail : node.label);
    group.append("rect").attr("width", box.w).attr("height", box.h)
      .attr("rx", parseFloat(token("radius-sm")) || 6);
    group.append("text").attr("class", "pv-flow-label").attr("x", 10).attr("y", node.detail ? 20 : 21)
      .text(clip(node.label, box.w - 20, 7.2));
    if (node.detail) {
      group.append("text").attr("class", "pv-flow-detail").attr("x", 10).attr("y", 38)
        .text(clip(node.detail, box.w - 20, 6.4));
    }
  });
}

function flow(target, spec) {
  if (typeof d3 === "undefined") throw new Error("pv.flow: D3 is not loaded");
  var el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) throw new Error("pv.flow: no element " + target);
  el.classList.add("pv-flow");
  var marker = "pv-arrow-" + ++flowCount;
  var current = { nodes: spec.nodes || [], edges: spec.edges || [], label: spec.label };
  var layout = flowLayers(current.nodes, current.edges);
  var width = el.clientWidth;
  drawFlow(el, current, layout, marker);
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(function () {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      drawFlow(el, current, layout, marker);
    }).observe(el);
  }
  return {
    update: function (next) {
      current = { nodes: next.nodes || [], edges: next.edges || [], label: next.label };
      layout = flowLayers(current.nodes, current.edges);
      drawFlow(el, current, layout, marker);
    },
  };
}
`;
