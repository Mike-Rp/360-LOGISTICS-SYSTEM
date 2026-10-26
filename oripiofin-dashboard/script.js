/* ============================================================
   OripioFin Dashboard - plain JavaScript, no framework
   ============================================================ */

// ---- Cash Flow chart data ----------------------------------
// Each value is a dollar amount. The Y-axis tops out at 50k,
// so a bar's height % = value / 50000 * 100.
var CHART_MAX = 50000;

var DATA = {
  yearly: [
    { label: "Jan", cashflow: 21000, inflow: 4200 },
    { label: "Feb", cashflow: 17500, inflow: 3100 },
    { label: "Mar", cashflow: 33847, inflow: -7456 },
    { label: "Apr", cashflow: 15200, inflow: 2600 },
    { label: "May", cashflow: 28400, inflow: 5100 },
    { label: "Jun", cashflow: 12800, inflow: 1900 },
    { label: "Jul", cashflow: 24600, inflow: 4400 }
  ],
  monthly: [
    { label: "W1", cashflow: 8200,  inflow: 1400 },
    { label: "W2", cashflow: 12600, inflow: 2600 },
    { label: "W3", cashflow: 9800,  inflow: -1200 },
    { label: "W4", cashflow: 15400, inflow: 3300 },
    { label: "W5", cashflow: 7300,  inflow: 900 }
  ]
};

var HIGHLIGHT_LABEL = "Mar"; // which bar is drawn in solid green

var barsEl    = document.getElementById("bars");
var tooltipEl = document.getElementById("tooltip");
var toggleEl  = document.getElementById("cashToggle");

function money(n) {
  var sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderChart(mode) {
  var rows = DATA[mode];
  barsEl.innerHTML = "";

  rows.forEach(function (row) {
    var col = document.createElement("div");
    col.className = "bar-col" + (row.label === HIGHLIGHT_LABEL ? " active" : "");

    var bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = Math.max(4, (row.cashflow / CHART_MAX) * 100) + "%";

    var label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = row.label;

    col.appendChild(bar);
    col.appendChild(label);
    barsEl.appendChild(col);

    // ---- hover tooltip ----
    col.addEventListener("mouseenter", function () {
      tooltipEl.hidden = false;
      tooltipEl.querySelector(".tt-date").textContent = row.label + " 23, 2026";
      var vals = tooltipEl.querySelectorAll(".tt-row b");
      vals[0].textContent = money(row.cashflow);
      vals[1].textContent = money(row.inflow);
      vals[1].classList.toggle("neg", row.inflow < 0);

      var chartBox = barsEl.parentElement.getBoundingClientRect();
      var colBox = col.getBoundingClientRect();
      var left = colBox.left - chartBox.left + colBox.width / 2;
      left = Math.min(left, chartBox.width - 160);
      tooltipEl.style.left = Math.max(0, left) + "px";
    });
    col.addEventListener("mouseleave", function () {
      tooltipEl.hidden = true;
    });
  });
}

// ---- Monthly / Yearly toggle ------------------------------
toggleEl.addEventListener("click", function (e) {
  var btn = e.target.closest("button");
  if (!btn) return;
  toggleEl.querySelectorAll("button").forEach(function (b) { b.classList.remove("on"); });
  btn.classList.add("on");
  renderChart(btn.dataset.mode);
});

// ---- Reset Data button (demo only) ------------------------
document.getElementById("resetBtn").addEventListener("click", function () {
  var active = toggleEl.querySelector("button.on").dataset.mode;
  renderChart(active);
});

// ---- initial paint ---------------------------------------
renderChart("yearly");

// ---- "select all" checkbox in the table ------------------
var headCheckbox = document.querySelector("thead input[type=checkbox]");
if (headCheckbox) {
  headCheckbox.addEventListener("change", function () {
    document.querySelectorAll("tbody input[type=checkbox]").forEach(function (cb) {
      cb.checked = headCheckbox.checked;
    });
  });
}
