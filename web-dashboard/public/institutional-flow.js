const resultsEl = document.querySelector("#flow-results");
const statusEl = document.querySelector("#flow-status");
const emptyEl = document.querySelector("#flow-empty");
const runButton = document.querySelector("#run-flow-button");

function setStatus(message) {
  statusEl.textContent = message || "";
}

function formatMoney(value, currency = "USD") {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
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

async function apiRequest(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function renderRecommendations(recommendations) {
  resultsEl.innerHTML = "";

  if (!recommendations.length) {
    emptyEl.classList.remove("hidden");
    return;
  }

  emptyEl.classList.add("hidden");
  recommendations.forEach((item) => {
    const article = document.createElement("article");
    article.className = "analysis-card";
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
        <span>${formatMoney(item.metrics.price)}</span>
        <span>Volume ${item.metrics.latestVolume?.toLocaleString?.() || "N/A"}</span>
        <span>20D Avg ${item.metrics.avgVolume20 == null ? "N/A" : Math.round(item.metrics.avgVolume20).toLocaleString()}</span>
        <span>Ratio ${item.metrics.volumeRatio20 == null ? "N/A" : `${item.metrics.volumeRatio20.toFixed(1)}x`}</span>
        <span>5D ${formatPercent(item.metrics.return5dPct)}</span>
        <span>20D ${formatPercent(item.metrics.return20dPct)}</span>
      </div>
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
    resultsEl.appendChild(article);
  });
}

async function loadFlow() {
  runButton.disabled = true;
  setStatus("Refreshing market flow leaders...");

  try {
    const payload = await apiRequest("/api/recommendations/institutional");
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

runButton.addEventListener("click", loadFlow);
loadFlow();
