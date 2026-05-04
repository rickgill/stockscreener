const resultsEl = document.querySelector("#trending-results");
const statusEl = document.querySelector("#trending-status");
const emptyEl = document.querySelector("#trending-empty");
const runButton = document.querySelector("#run-trending-button");

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
  if (label.includes("Buy") || label.includes("Momentum")) {
    return "positive";
  }
  if (label.includes("Sell") || label.includes("Risk")) {
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
  recommendations.forEach((item, index) => {
    const article = document.createElement("article");
    article.className = "analysis-card";
    article.innerHTML = `
      <div class="analysis-head">
        <div>
          <p class="field-label">#${index + 1} · ${item.symbol}</p>
          <h2>${item.shortName || item.symbol}</h2>
        </div>
        <div class="signal-chip ${recommendationClass(item.recommendation)}">${item.recommendation}</div>
      </div>
      <p class="analysis-score">Activity score ${item.activityScore.toFixed(1)}</p>
      <div class="metric-strip">
        <span>${formatMoney(item.metrics.price)}</span>
        <span>Today ${formatPercent(item.metrics.priceChangePct)}</span>
        <span>5D ${formatPercent(item.metrics.return5dPct)}</span>
        <span>20D ${formatPercent(item.metrics.return20dPct)}</span>
        <span>20D Vol ${item.metrics.volumeRatio20 == null ? "N/A" : `${item.metrics.volumeRatio20.toFixed(1)}x`}</span>
      </div>
      <ul class="analysis-notes">
        ${item.summary.map((note) => `<li>${note}</li>`).join("")}
      </ul>
    `;
    resultsEl.appendChild(article);
  });
}

async function loadTrending() {
  runButton.disabled = true;
  setStatus("Refreshing trending stocks...");

  try {
    const payload = await apiRequest("/api/recommendations/trending");
    renderRecommendations(payload.recommendations || []);
    setStatus(payload.recommendations?.length ? "Trending 20 updated." : "");
  } catch (error) {
    resultsEl.innerHTML = "";
    emptyEl.classList.add("hidden");
    setStatus(error.message);
  } finally {
    runButton.disabled = false;
  }
}

runButton.addEventListener("click", loadTrending);
loadTrending();
