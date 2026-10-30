import type { VisualizeInput } from "../src/index.ts";

/** Sliders bound to stat tiles and a Chart.js balance curve. */
export const loanCalculator: VisualizeInput = {
  title: "Loan payments by rate and term",
  html: String.raw`<style>
  .loan-inputs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 8px 20px; margin: 16px 0 8px; }
</style>
<div class="pv-stats">
  <div class="pv-stat"><div class="pv-stat-label">Monthly payment</div><div class="pv-stat-value" id="payment">-</div></div>
  <div class="pv-stat"><div class="pv-stat-label">Total interest</div><div class="pv-stat-value" id="interest">-</div><div class="pv-stat-sub" id="share"></div></div>
  <div class="pv-stat"><div class="pv-stat-label">Total paid</div><div class="pv-stat-value" id="total">-</div></div>
</div>
<div class="loan-inputs">
  <label class="pv-slider"><span>Amount</span><output></output><input type="range" id="amount" min="50000" max="1000000" step="10000" value="400000" data-prefix="$"></label>
  <label class="pv-slider"><span>Rate</span><output></output><input type="range" id="rate" min="2" max="9" step="0.125" value="6.5" data-suffix="%"></label>
  <label class="pv-slider"><span>Term</span><output></output><input type="range" id="years" min="5" max="30" step="5" value="30" data-suffix=" years"></label>
</div>
<div id="balance"></div>
<p class="pv-caption">Remaining balance at the end of each year, with interest paid so far.</p>
<script>
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const chart = pv.chart("#balance", {
    type: "line",
    data: { labels: [], datasets: [
      { label: "Balance", data: [], tension: 0.25, pointRadius: 0 },
      { label: "Interest paid", data: [], tension: 0.25, pointRadius: 0 },
    ] },
    options: { interaction: { mode: "index", intersect: false }, scales: { y: { ticks: { callback: (v) => money.format(v) } } } },
  });
  function schedule(principal, ratePct, years) {
    const r = ratePct / 100 / 12;
    const n = years * 12;
    const payment = r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
    let balance = principal;
    let interest = 0;
    const rows = [{ year: 0, balance, interest }];
    for (let month = 1; month <= n; month++) {
      const due = balance * r;
      interest += due;
      balance = Math.max(0, balance - (payment - due));
      if (month % 12 === 0) rows.push({ year: month / 12, balance, interest });
    }
    return { payment, interest, rows };
  }
  pv.bind(".loan-inputs input", (v) => {
    const plan = schedule(v.amount, v.rate, v.years);
    document.getElementById("payment").textContent = money.format(plan.payment);
    document.getElementById("interest").textContent = money.format(plan.interest);
    document.getElementById("total").textContent = money.format(v.amount + plan.interest);
    document.getElementById("share").textContent = Math.round((plan.interest / (v.amount + plan.interest)) * 100) + "% of what you pay";
    chart.data.labels = plan.rows.map((row) => "Year " + row.year);
    chart.data.datasets[0].data = plan.rows.map((row) => Math.round(row.balance));
    chart.data.datasets[1].data = plan.rows.map((row) => Math.round(row.interest));
    chart.update("none");
  });
</script>`,
};
