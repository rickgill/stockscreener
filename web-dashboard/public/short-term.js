const resultsEl = document.querySelector("#short-term-results");
const statusEl = document.querySelector("#short-term-status");
const emptyEl = document.querySelector("#short-term-empty");
const runButton = document.querySelector("#run-short-term-button");
const watchlistSelectEl = document.querySelector("#short-term-watchlist-select");
const groupTabsEl = document.querySelector("#short-term-group-tabs");
const globalRangeTabsEl = document.querySelector("#short-term-range-tabs");

const groupStorageKey = "short-term-grouping";
const watchlistStorageKey = "short-term-watchlist";
const groupModes = [
  { key: "watchlist", label: "Watchlist order" },
  { key: "actions", label: "Action buckets" },
];
const actionOrder = ["Action Now", "Near Trigger", "Watch Only", "Avoid", "Skipped / unavailable"];
const groupButtons = new Map();
const chartCards = new Map();

let currentGroup = loadGroup();
let currentWatchlist = loadWatchlist();
let currentWatchlists = [];

function setStatus(message) {
  statusEl.textContent = message || "";
}

function loadGroup() {
  const value = localStorage.getItem(groupStorageKey) || "actions";
  return groupModes.some((mode) => mode.key === value) ? value : "actions";
}

function saveGroup(value) {
  localStorage.setItem(groupStorageKey, value);
}

function loadWatchlist() {
  return localStorage.getItem(watchlistStorageKey) || "all";
}

function saveWatchlist(value) {
  localStorage.setItem(watchlistStorageKey, String(value));
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatHitRate(value) {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }

  return `${(value * 100).toFixed(0)}%`;
}

function recommendationClass(item) {
  if (!item || item.recommendation === "Avoid") {
    return "negative";
  }
  if (item.bias === "Long") {
    return "positive";
  }
  if (item.bias === "Short") {
    return "negative";
  }
  return "";
}

function updateGroupButtons() {
  groupButtons.forEach((button, key) => {
    button.classList.toggle("active", key === currentGroup);
    button.setAttribute("aria-pressed", String(key === currentGroup));
  });
}

function renderWatchlistOptions(activeWatchlist) {
  currentWatchlist = String(activeWatchlist);
  saveWatchlist(currentWatchlist);
  watchlistSelectEl.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All watchlists";
  watchlistSelectEl.appendChild(allOption);

  currentWatchlists.forEach((watchlist) => {
    const option = document.createElement("option");
    option.value = String(watchlist.id);
    option.textContent = watchlist.name;
    watchlistSelectEl.appendChild(option);
  });

  watchlistSelectEl.value = currentWatchlist;
}

function initGroupTabs() {
  groupModes.forEach((mode) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-pill";
    button.textContent = mode.label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      if (mode.key === currentGroup) {
        return;
      }
      currentGroup = mode.key;
      saveGroup(mode.key);
      updateGroupButtons();
      loadShortTerm();
    });
    groupButtons.set(mode.key, button);
    groupTabsEl.appendChild(button);
  });

  updateGroupButtons();
}

function createGroupSection(title, copy, count) {
  const section = document.createElement("section");
  section.className = "group-section short-term-group-section";
  section.innerHTML = `
    <div class="group-section-head">
      <div>
        <h2 class="group-section-title">${title}</h2>
        <p class="group-section-copy">${copy}</p>
      </div>
      <span class="group-section-count">${count} ${count === 1 ? "setup" : "setups"}</span>
    </div>
  `;
  const grid = document.createElement("div");
  grid.className = "group-section-grid short-term-group-grid";
  section.appendChild(grid);
  return { section, grid };
}

function createSkippedCard(symbol, error) {
  const article = document.createElement("article");
  article.className = "analysis-card";
  article.innerHTML = `
    <div class="analysis-head">
      <div>
        <p class="field-label">${symbol}</p>
        <h2>${symbol}</h2>
      </div>
      <div class="signal-chip">Skipped</div>
    </div>
    <p class="analysis-score">Market data could not be loaded for this saved symbol.</p>
    <ul class="analysis-notes">
      <li>${error || "Upstream market data was unavailable."}</li>
    </ul>
  `;
  return article;
}

const globalRange = SignalCharts.createGlobalRangeController(
  "short-term-global-range",
  globalRangeTabsEl,
  (range) => {
    chartCards.forEach((card) => card.setRange(range));
    setStatus(`Global chart range changed to ${SignalCharts.getRangeLabel(range)}.`);
  }
);

function createShortTermCard(item) {
  const article = document.createElement("article");
  article.className = "analysis-card analysis-chart-card short-term-card";
  article.innerHTML = `
    <div class="analysis-head">
      <div>
        <p class="field-label">${item.symbol}</p>
        <h2>${item.shortName || item.symbol}</h2>
      </div>
      <div class="signal-chip ${recommendationClass(item)}">${item.recommendation}</div>
    </div>
    <p class="analysis-score">${item.setupType} - ${item.bias} bias - Confidence ${item.confidence}</p>
    <div class="metric-strip">
      <span>${SignalCharts.formatMoney(item.metrics.price)}</span>
      <span>Today ${formatPercent(item.metrics.oneDayChangePct)}</span>
      <span>RVOL ${item.metrics.volumeRatio20 == null ? "N/A" : `${item.metrics.volumeRatio20.toFixed(1)}x`}</span>
      <span>RSI ${item.metrics.rsi14 == null ? "N/A" : item.metrics.rsi14.toFixed(1)}</span>
      <span>3D Exp ${formatPercent(item.metrics.expectedReturn3d)}</span>
      <span>5D Exp ${formatPercent(item.metrics.expectedReturn5d)}</span>
    </div>
    <div class="setup-metric-grid">
      <div class="setup-metric-box">
        <span class="field-label">Trigger</span>
        <strong>${SignalCharts.formatMoney(item.metrics.triggerPrice)}</strong>
      </div>
      <div class="setup-metric-box">
        <span class="field-label">Stop</span>
        <strong>${SignalCharts.formatMoney(item.metrics.stopPrice)}</strong>
      </div>
      <div class="setup-metric-box">
        <span class="field-label">Target</span>
        <strong>${SignalCharts.formatMoney(item.metrics.targetPrice)}</strong>
      </div>
      <div class="setup-metric-box">
        <span class="field-label">5D Hit</span>
        <strong>${formatHitRate(item.metrics.hitRate5d)}</strong>
      </div>
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
      <p class="field-label">Risk framing</p>
      <div class="holder-list">
        <span class="holder-pill">ATR stop ${formatPercent(item.metrics.stopDistancePct)}</span>
        <span class="holder-pill">Target ${formatPercent(item.metrics.targetDistancePct)}</span>
        <span class="holder-pill">${item.metrics.tooExtended ? "Extended" : "Not extended"}</span>
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

  async function loadChart() {
    if (isLoading) {
      return;
    }

    isLoading = true;
    status.textContent = `Loading ${SignalCharts.getRangeLabel(currentRange)} chart...`;
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

  SignalCharts.rangePresets.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "range-pill range-pill-local";
    button.textContent = preset.label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      if (preset.key === currentRange) {
        return;
      }
      currentRange = preset.key;
      updateLocalButtons();
      loadChart();
    });
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

function appendOrderedResults(grid, orderedSymbols, recommendationMap, skippedMap) {
  orderedSymbols.forEach((symbol) => {
    const recommendation = recommendationMap.get(symbol);
    if (recommendation) {
      const card = createShortTermCard(recommendation);
      chartCards.set(symbol, card);
      grid.appendChild(card.article);
      return;
    }

    const skipped = skippedMap.get(symbol);
    if (skipped) {
      grid.appendChild(createSkippedCard(symbol, skipped.error));
    }
  });
}

function renderResults(payload) {
  const recommendations = payload.recommendations || [];
  const skippedSymbols = payload.skippedSymbols || [];
  const requestedSymbols = payload.requestedSymbols || [];
  chartCards.clear();
  resultsEl.innerHTML = "";
  resultsEl.className = "analysis-grid short-term-results-grid";

  if (!requestedSymbols.length) {
    emptyEl.classList.remove("hidden");
    return;
  }

  emptyEl.classList.add("hidden");

  const recommendationMap = new Map(recommendations.map((item) => [item.symbol, item]));
  const skippedMap = new Map(skippedSymbols.map((item) => [item.symbol, item]));

  if (currentGroup === "actions") {
    const buckets = new Map(actionOrder.map((key) => [key, []]));
    recommendations.forEach((item) => {
      const bucketKey = buckets.has(item.recommendation) ? item.recommendation : "Watch Only";
      buckets.get(bucketKey).push(item);
    });
    skippedSymbols.forEach((item) => buckets.get("Skipped / unavailable").push(item));

    actionOrder.forEach((bucket) => {
      const items = buckets.get(bucket) || [];
      if (!items.length) {
        return;
      }
      const description =
        bucket === "Action Now"
          ? "Best aligned short-term setups with trigger and liquidity support."
          : bucket === "Near Trigger"
            ? "Setups close to actionable but not yet fully confirmed."
            : bucket === "Watch Only"
              ? "Interesting names that still need cleaner structure or timing."
              : bucket === "Avoid"
                ? "Weak, extended, or illiquid setups."
                : "Saved symbols that could not be evaluated.";
      const { section, grid } = createGroupSection(bucket, description, items.length);
      items.forEach((item) => {
        if (item.symbol && !item.recommendation) {
          grid.appendChild(createSkippedCard(item.symbol, item.error));
          return;
        }
        const card = createShortTermCard(item);
        chartCards.set(item.symbol, card);
        grid.appendChild(card.article);
      });
      resultsEl.appendChild(section);
    });
    return;
  }

  if (currentWatchlist === "all") {
    currentWatchlists.forEach((watchlist) => {
      if (!watchlist.symbols?.length) {
        return;
      }
      const symbols = watchlist.symbols.filter((symbol) => recommendationMap.has(symbol) || skippedMap.has(symbol));
      if (!symbols.length) {
        return;
      }
      const { section, grid } = createGroupSection(
        watchlist.name,
        "Short-term setups for this watchlist, preserved in dashboard order.",
        symbols.length
      );
      appendOrderedResults(grid, symbols, recommendationMap, skippedMap);
      resultsEl.appendChild(section);
    });
    return;
  }

  appendOrderedResults(resultsEl, requestedSymbols, recommendationMap, skippedMap);
}

async function apiRequest(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

async function loadShortTerm() {
  runButton.disabled = true;
  setStatus("Refreshing short-term setups...");

  try {
    const payload = await apiRequest(`/api/recommendations/short-term?watchlist=${encodeURIComponent(currentWatchlist)}`);
    currentWatchlists = payload.watchlists || [];
    renderWatchlistOptions(payload.activeWatchlist || currentWatchlist);
    renderResults(payload);
    const skippedCount = payload.skippedSymbols?.length || 0;
    if (!payload.requestedSymbols?.length) {
      setStatus("");
    } else {
      setStatus(
        skippedCount
          ? `Short-term setups refreshed. ${skippedCount} symbol${skippedCount === 1 ? "" : "s"} skipped.`
          : "Short-term setups refreshed."
      );
    }
  } catch (error) {
    resultsEl.innerHTML = "";
    emptyEl.classList.add("hidden");
    setStatus(error.message);
  } finally {
    runButton.disabled = false;
  }
}

watchlistSelectEl.addEventListener("change", () => {
  currentWatchlist = watchlistSelectEl.value || "all";
  saveWatchlist(currentWatchlist);
  loadShortTerm();
});

runButton.addEventListener("click", loadShortTerm);

window.addEventListener("resize", () => {
  chartCards.forEach((card) => card.redraw());
});

initGroupTabs();
loadShortTerm();
