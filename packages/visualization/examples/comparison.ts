import type { VisualizeInput } from "../src/index.ts";

/** Tabs over a table and a bar chart, comparing three options. */
export const comparison: VisualizeInput = {
  title: "SQLite, Postgres and DuckDB for the event store",
  html: String.raw`<div class="pv-tabs" role="tablist" aria-label="View">
  <button role="tab" aria-selected="true" aria-controls="table-view">Table</button>
  <button role="tab" aria-selected="false" aria-controls="chart-view" tabindex="-1">Chart</button>
</div>
<div role="tabpanel" id="table-view">
  <div class="pv-table-wrap"><table class="pv-table">
    <thead><tr><th>Store</th><th class="pv-num">Append p50</th><th class="pv-num">Idle memory</th><th>Runs on a Pi 4</th></tr></thead>
    <tbody id="rows"></tbody>
  </table></div>
</div>
<div role="tabpanel" id="chart-view" hidden>
  <div id="bars" style="height:220px"></div>
</div>
<p class="pv-caption">Sample figures for this fixture, not measurements.</p>
<script>
  const STORES = [
    { name: "SQLite (WAL)", append: 0.18, memory: 6, pi: "Yes" },
    { name: "Postgres 17", append: 0.92, memory: 48, pi: "With tuning" },
    { name: "DuckDB", append: 1.4, memory: 31, pi: "Yes" },
  ];
  const rows = document.getElementById("rows");
  STORES.forEach((store) => {
    const tr = document.createElement("tr");
    [store.name, store.append.toFixed(2) + " ms", store.memory + " MB", store.pi].forEach((text, i) => {
      const td = document.createElement("td");
      if (i === 1 || i === 2) td.className = "pv-num";
      td.textContent = text;
      tr.appendChild(td);
    });
    rows.appendChild(tr);
  });
  let bars = null;
  document.addEventListener("pv:tab", (event) => {
    if (bars || event.detail.tab.getAttribute("aria-controls") !== "chart-view") return;
    bars = pv.chart("#bars", {
      type: "bar",
      data: { labels: STORES.map((s) => s.name), datasets: [{ label: "Append p50 (ms)", data: STORES.map((s) => s.append) }] },
      options: { indexAxis: "y", plugins: { legend: { display: false } } },
    });
  });
</script>`,
};
