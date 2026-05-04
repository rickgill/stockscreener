const resultsEl = document.querySelector("#flow-results");
const statusEl = document.querySelector("#flow-status");
const emptyEl = document.querySelector("#flow-empty");
const runButton = document.querySelector("#run-flow-button");
const globalRangeTabsEl = document.querySelector("#flow-range-tabs");
const flowCards = new Map();

function setStatus(message) {
  statusEl.textContent = message || "";
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function recommendationClass(label) {
  if (label.includes("Buy") || label.includes("Accumulate")) {
    return "positive";
  }
  if (label.includes("Sell") || label.includes("Distribution")) {
    return "negative";
  }
  return "";
}

const globalRange = SignalCharts.createGlobalRangeController(
  "market-flow-global-range",
  globalRangeTabsEl,
  (range) => {
    flowCards.forEach((card) => card.setRange(range, { fromGlobal: true }));
    setStatus(`Global chart range changed to ${SignalCharts.getRangeLabel(range)}.`);
  }
);

function createChartCard(item) {
  const article = document.createElement("article");
  article.className = "analysis-card analysis-chart-card";
  article.innerHTML = `
    <div class="analysis-head">
      <div>
        <p class="field-label">${item.symbol}</p>
        <h2>${item.shortName || item.symbol}</h2>
      </div>
      <div class="signal-chip ${recommendationClass(item.recommendation)}">${item.recommendation}</div>
    </div>
    <p class="analysis-score">Flow score ${item.score} · Confidence ${item.confidence}</p>
    <div class="metric-strip">
      <span>${SignalCharts.formatMoney(item.metrics.price)}</span>
      <span>Volume ${item.metrics.latestVolume?.toLocaleString?.() || "N/A"}</span>
      <span>20D Avg ${item.metrics.avgVolume20 == null ? "N/A" : Math.round(item.metrics.avgVolume20).toLocaleString()}</span>
      <span>Ratio ${item.metrics.volumeRatio20 == null ? "N/A" : `${item.metrics.volumeRatio20.toFixed(1)}x`}</span>
      <span>5D ${formatPercent(item.metrics.return5dPct)}</span>
      <span>20D ${formatPercent(item.metrics.return20dPct)}</span>
    </div>
    <div class="analysis-chart-header">
      <span class="field-label">Inline chart</span>
      <span class="analysis-chart-status">Waiting for data</span>
    </div>
    <div class="range-tabs analysis-local-range-tabs" role="group" aria-label="${item.symbol} chart range options"></div>
    <section class="chart-section analysis-chart-section">
      <div class="chart-meta-left">
        <span class="price-tag"></span>
      </div>
      <div class="chart-panel">
        <div class="chart-side-labels"></div>
        <canvas class="chart" width="900" height="360"></canvas>
        <div class="chart-x-labels"></div>
        <div class="chart-previous-close"></div>
      </div>
    </section>
    <ul class="analysis-notes">
      ${item.summary.map((note) => `<li>${note}</li>`).join("")}
    </ul>
    <div class="holder-block">
      <p class="field-label">Current bias</p>
      <div class="holder-list">
        <span class="holder-pill">${formatPercent(item.metrics.priceChangePct)} today</span>
        <span class="holder-pill">${item.metrics.rsi14 == null ? "RSI N/A" : `RSI ${item.metrics.rsi14.toFixed(1)}`}</span>
      </div>
    </div>
  `;

  const status = article.querySelector(".analysis-chart-status");
  const rangeTabsEl = article.querySelector(".analysis-local-range-tabs");
  const canvas = article.querySelector(".chart");
  const sideLabelsEl = article.querySelector(".chart-side-labels");
  const xLabelsEl = article.querySelector(".chart-x-labels");
  const previousCloseEl = article.querySelector(".chart-previous-close");
  const priceTagEl = article.querySelector(".price-tag");
  const localButtons = new Map();
  let currentRange = globalRange.getRange();
  let currentPayload = null;
  let isLoading = false;

  function updateLocalButtons() {
    localButtons.forEach((button, key) => {
      button.classList.toggle("active", key === currentRange);
      button.setAttribute("aria-pressed", String(key === currentRange));
    });
  }

  async function loadChart(options = {}) {
    if (isLoading) {
      return;
    }

    isLoading = true;
    status.textContent = options.background ? "Updating chart..." : `Loading ${SignalCharts.getRangeLabel(currentRange)} chart...`;
    try {
      currentPayload = await SignalCharts.apiRequest(
        `/api/history?symbol=${encodeURIComponent(item.symbol)}&range=${encodeURIComponent(currentRange)}`
      );
      SignalCharts.drawChart(canvas, currentPayload, sideLabelsEl, xLabelsEl, previousCloseEl, priceTagEl);
      status.textContent = `${SignalCharts.getRangeLabel(currentPayload.range)} chart`;
    } catch (error) {
      status.textContent = error.message;
      priceTagEl.textContent = "";
      previousCloseEl.textContent = "";
      xLabelsEl.innerHTML = "";
      sideLabelsEl.innerHTML = "";
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    } finally {
      isLoading = false;
      updateLocalButtons();
    }
  }

  function setRange(range) {
    if (range === currentRange) {
      return;
    }

    currentRange = range;
    updateLocalButtons();
    loadChart();
  }

  SignalCharts.rangePresets.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "range-pill range-pill-local";
    button.textContent = preset.label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => setRange(preset.key));
    localButtons.set(preset.key, button);
    rangeTabsEl.appendChild(button);
  });

  updateLocalButtons();
  loadChart();

  return {
    article,
    setRange(range) {
      currentRange = range;
      updateLocalButtons();
      loadChart();
    },
    redraw() {
      if (currentPayload) {
        SignalCharts.drawChart(canvas, currentPayload, sideLabelsEl, xLabelsEl, previousCloseEl, priceTagEl);
      }
    },
  };
}

function renderRecommendations(recommendations) {
  resultsEl.innerHTML = "";
  flowCards.clear();

  if (!recommendations.length) {
    emptyEl.classList.remove("hidden");
    return;
  }

  emptyEl.classList.add("hidden");
  recommendations.forEach((item) => {
    const card = createChartCard(item);
    flowCards.set(item.symbol, card);
    resultsEl.appendChild(card.article);
  });
}

async function loadFlow() {
  runButton.disabled = true;
  setStatus("Refreshing market flow leaders...");

  try {
    const payload = await SignalCharts.apiRequest("/api/recommendations/institutional");
    renderRecommendations(payload.recommendations || []);
    setStatus(payload.recommendations?.length ? "Market flow leaders updated." : "");
  } catch (error) {
    resultsEl.innerHTML = "";
    emptyEl.classList.add("hidden");
    setStatus(error.message);
  } finally {
    runButton.disabled = false;
  }
}

window.addEventListener("resize", () => {
  flowCards.forEach((card) => card.redraw());
});

runButton.addEventListener("click", loadFlow);
loadFlow();
