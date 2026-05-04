const resultsEl = document.querySelector("#screen-results");
const statusEl = document.querySelector("#screen-status");
const emptyEl = document.querySelector("#screen-empty");
const runButton = document.querySelector("#run-screen-button");

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
  if (label.includes("Buy")) {
    return "positive";
  }
  if (label.includes("Sell")) {
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
  recommendations
    .sort((left, right) => right.score - left.score)
    .forEach((item) => {
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
        <p class="analysis-score">Score ${item.score} · Confidence ${item.confidence}</p>
        <div class="metric-strip">
          <span>${formatMoney(item.metrics.price)}</span>
          <span>1D ${formatPercent(item.metrics.oneDayChangePct)}</span>
          <span>1M ${formatPercent(item.metrics.monthReturnPct)}</span>
          <span>RSI ${item.metrics.rsi14 == null ? "N/A" : item.metrics.rsi14.toFixed(1)}</span>
        </div>
        <ul class="analysis-notes">
          ${item.summary.map((note) => `<li>${note}</li>`).join("")}
        </ul>
      `;
      resultsEl.appendChild(article);
    });
}

async function loadScreen() {
  runButton.disabled = true;
  setStatus("Running technical screen...");

  try {
    const payload = await apiRequest("/api/recommendations/technical");
    renderRecommendations(payload.recommendations || []);
    setStatus(payload.recommendations?.length ? "Screen updated." : "");
  } catch (error) {
    resultsEl.innerHTML = "";
    emptyEl.classList.add("hidden");
    setStatus(error.message);
  } finally {
    runButton.disabled = false;
  }
}

runButton.addEventListener("click", loadScreen);
loadScreen();
