const resultsEl = document.querySelector("#screen-results");
const statusEl = document.querySelector("#screen-status");
const emptyEl = document.querySelector("#screen-empty");
const runButton = document.querySelector("#run-screen-button");
const screenWatchlistSelectEl = document.querySelector("#screen-watchlist-select");
const backtestSummaryEl = document.querySelector("#backtest-summary");
const backtestDirectionsEl = document.querySelector("#backtest-directions");
const backtestSymbolsEl = document.querySelector("#backtest-symbols");
const screenGroupTabsEl = document.querySelector("#screen-group-tabs");
const backtestStatusEl = document.querySelector("#backtest-status");
const backtestEmptyEl = document.querySelector("#backtest-empty");
const backtestButton = document.querySelector("#run-backtest-button");
const exportBacktestButton = document.querySelector("#export-backtest-button");
const screenGroupStorageKey = "screen-signal-grouping";
const screenWatchlistStorageKey = "screen-watchlist-view";
const screenGroupModes = [
  { key: "watchlist", label: "Watchlist order" },
  { key: "signals", label: "Signal buckets" },
];
const screenGroupButtons = new Map();
let hasBacktestData = false;
let currentScreenGroup = loadScreenGroup();
let currentScreenWatchlist = loadScreenWatchlist();
let currentWatchlists = [];

function setStatus(message) {
  statusEl.textContent = message || "";
}

function setBacktestStatus(message) {
  backtestStatusEl.textContent = message || "";
}

function saveScreenGroup(group) {
  localStorage.setItem(screenGroupStorageKey, group);
}

function loadScreenGroup() {
  const value = localStorage.getItem(screenGroupStorageKey) || "watchlist";
  return screenGroupModes.some((mode) => mode.key === value) ? value : "watchlist";
}

function saveScreenWatchlist(value) {
  localStorage.setItem(screenWatchlistStorageKey, String(value));
}

function loadScreenWatchlist() {
  return localStorage.getItem(screenWatchlistStorageKey) || "all";
}

function formatSkippedSymbols(skippedSymbols) {
  if (!Array.isArray(skippedSymbols) || !skippedSymbols.length) {
    return "";
  }

  const labels = skippedSymbols.map((item) => item.symbol).join(", ");
  return `Skipped symbols: ${labels}.`;
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

function formatHitRate(value) {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }

  return `${(value * 100).toFixed(0)}%`;
}

function recommendationClass(label) {
  if ((label || "").includes("Buy")) {
    return "positive";
  }
  if ((label || "").includes("Sell")) {
    return "negative";
  }
  return "";
}

function formatDirectionLabel(direction) {
  switch (direction) {
    case "long":
      return "Long setups";
    case "short":
      return "Short setups";
    case "flat":
      return "Flat / no-trade";
    default:
      return direction || "N/A";
  }
}

function updateScreenGroupButtons() {
  screenGroupButtons.forEach((button, key) => {
    button.classList.toggle("active", key === currentScreenGroup);
    button.setAttribute("aria-pressed", String(key === currentScreenGroup));
  });
}

function renderWatchlistOptions(activeWatchlist) {
  currentScreenWatchlist = String(activeWatchlist);
  saveScreenWatchlist(currentScreenWatchlist);
  screenWatchlistSelectEl.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All watchlists";
  screenWatchlistSelectEl.appendChild(allOption);

  currentWatchlists.forEach((watchlist) => {
    const option = document.createElement("option");
    option.value = String(watchlist.id);
    option.textContent = watchlist.name;
    screenWatchlistSelectEl.appendChild(option);
  });

  screenWatchlistSelectEl.value = currentScreenWatchlist;
}

function initScreenGroupTabs() {
  screenGroupModes.forEach((mode) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-pill";
    button.textContent = mode.label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      if (mode.key === currentScreenGroup) {
        return;
      }
      currentScreenGroup = mode.key;
      saveScreenGroup(mode.key);
      updateScreenGroupButtons();
      loadScreen();
    });
    screenGroupButtons.set(mode.key, button);
    screenGroupTabsEl.appendChild(button);
  });
  updateScreenGroupButtons();
}

async function apiRequest(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function appendRecommendationCard(item) {
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
    <p class="analysis-score">Score ${item.score} - Confidence ${item.confidence}</p>
    <div class="metric-strip">
      <span>${formatMoney(item.metrics.price)}</span>
      <span>1D ${formatPercent(item.metrics.oneDayChangePct)}</span>
      <span>1M ${formatPercent(item.metrics.monthReturnPct)}</span>
      <span>RSI ${item.metrics.rsi14 == null ? "N/A" : item.metrics.rsi14.toFixed(1)}</span>
      <span>5D Hit ${formatHitRate(item.metrics.hitRate5d)}</span>
      <span>20D Exp ${formatPercent(item.metrics.expectedReturn20d)}</span>
      <span>ATR Stop ${formatPercent(item.metrics.stopDistancePct)}</span>
    </div>
    <ul class="analysis-notes">
      ${item.summary.map((note) => `<li>${note}</li>`).join("")}
    </ul>
  `;
  return article;
}

function renderRecommendations(recommendations) {
  resultsEl.innerHTML = "";
  resultsEl.className = "analysis-grid";

  if (!recommendations.length) {
    emptyEl.classList.remove("hidden");
    return;
  }

  emptyEl.classList.add("hidden");
  recommendations.forEach((item) => resultsEl.appendChild(appendRecommendationCard(item)));
}

function renderSkippedRecommendationCard(symbol, error) {
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
    <p class="analysis-score">No recommendation generated for this saved dashboard symbol.</p>
    <ul class="analysis-notes">
      <li>${error || "Market data was unavailable for this symbol."}</li>
    </ul>
  `;
  return article;
}

function createGroupSection(title, copy, count) {
  const section = document.createElement("section");
  section.className = "group-section";
  section.innerHTML = `
    <div class="group-section-head">
      <div>
        <h2 class="group-section-title">${title}</h2>
        <p class="group-section-copy">${copy}</p>
      </div>
      <span class="group-section-count">${count} ${count === 1 ? "signal" : "signals"}</span>
    </div>
  `;
  const grid = document.createElement("div");
  grid.className = "group-section-grid";
  section.appendChild(grid);
  return { section, grid };
}


function renderBacktest(payload) {
  const summary = payload.summary || [];
  const directionSummary = payload.directionSummary || [];
  const symbols = payload.symbols || [];
  hasBacktestData = summary.length > 0 || directionSummary.length > 0 || symbols.length > 0;
  backtestSummaryEl.innerHTML = "";
  backtestDirectionsEl.innerHTML = "";
  backtestSymbolsEl.innerHTML = "";

  if (!summary.length && !directionSummary.length && !symbols.length) {
    backtestEmptyEl.classList.remove("hidden");
    return;
  }

  backtestEmptyEl.classList.add("hidden");

  summary
    .sort((left, right) => right.totalSignals - left.totalSignals)
    .forEach((item) => {
      const card = document.createElement("article");
      card.className = "analysis-card";
      card.innerHTML = `
        <div class="analysis-head">
          <div>
            <p class="field-label">Recommendation bucket</p>
            <h2>${item.recommendation}</h2>
          </div>
          <div class="signal-chip ${recommendationClass(item.recommendation)}">${item.totalSignals} signals</div>
        </div>
        <div class="metric-strip">
          <span>5D Hit ${formatHitRate(item.hitRate5d)}</span>
          <span>20D Hit ${formatHitRate(item.hitRate20d)}</span>
          <span>20D Alpha Hit ${formatHitRate(item.alphaHitRate20d)}</span>
          <span>20D Net ${formatPercent(item.avgNet20d)}</span>
          <span>20D Alpha Net ${formatPercent(item.avgAlphaNet20d)}</span>
        </div>
      `;
      backtestSummaryEl.appendChild(card);
    });

  directionSummary
    .sort((left, right) => right.totalSignals - left.totalSignals)
    .forEach((item) => {
      const card = document.createElement("article");
      card.className = "analysis-card";
      card.innerHTML = `
        <div class="analysis-head">
          <div>
            <p class="field-label">Directional evaluation</p>
            <h2>${formatDirectionLabel(item.direction)}</h2>
          </div>
          <div class="signal-chip">${item.totalSignals} signals</div>
        </div>
        <div class="metric-strip">
          <span>20D Hit ${formatHitRate(item.hitRate20d)}</span>
          <span>20D Alpha Hit ${formatHitRate(item.alphaHitRate20d)}</span>
          <span>20D Net ${formatPercent(item.avgNet20d)}</span>
          <span>20D Alpha Net ${formatPercent(item.avgAlphaNet20d)}</span>
        </div>
      `;
      backtestDirectionsEl.appendChild(card);
    });

  symbols
    .sort((left, right) => (right.overall?.totalSignals || 0) - (left.overall?.totalSignals || 0))
    .forEach((item) => {
      const longStats = item.byDirection?.long || null;
      const shortStats = item.byDirection?.short || null;
      const flatStats = item.byDirection?.flat || null;
      const benchmarkSymbol = item.records?.[0]?.benchmarkSymbol || "benchmark";
      const card = document.createElement("article");
      card.className = "analysis-card";
      card.innerHTML = `
        <div class="analysis-head">
          <div>
            <p class="field-label">${item.symbol}</p>
            <h2>${item.shortName || item.symbol}</h2>
          </div>
          <div class="signal-chip">${item.totalWindows} windows</div>
        </div>
        <div class="metric-strip">
          <span>Overall 20D ${formatHitRate(item.overall?.hitRate20d)}</span>
          <span>Overall Alpha ${formatHitRate(item.overall?.alphaHitRate20d)}</span>
          <span>20D Net ${formatPercent(item.overall?.avgNet20d)}</span>
          <span>20D Alpha Net ${formatPercent(item.overall?.avgAlphaNet20d)}</span>
        </div>
        <ul class="analysis-notes">
          <li>All signals: ${item.overall?.totalSignals || 0} windows, 20-day alpha net ${formatPercent(item.overall?.avgAlphaNet20d)} versus ${benchmarkSymbol}.</li>
          <li>Long setups: ${longStats?.totalSignals || 0} windows, hit ${formatHitRate(longStats?.hitRate20d)}, alpha hit ${formatHitRate(longStats?.alphaHitRate20d)}, net ${formatPercent(longStats?.avgNet20d)}.</li>
          <li>Short setups: ${shortStats?.totalSignals || 0} windows, hit ${formatHitRate(shortStats?.hitRate20d)}, alpha hit ${formatHitRate(shortStats?.alphaHitRate20d)}, net ${formatPercent(shortStats?.avgNet20d)}.</li>
          <li>Flat states: ${flatStats?.totalSignals || 0} windows, alpha net ${formatPercent(flatStats?.avgAlphaNet20d)} after turnover assumptions.</li>
        </ul>
      `;
      backtestSymbolsEl.appendChild(card);
    });
}

async function loadScreen() {
  runButton.disabled = true;
  setStatus("Running technical screen...");

  try {
    const payload = await apiRequest(
      `/api/recommendations/technical?watchlist=${encodeURIComponent(currentScreenWatchlist)}`
    );
    currentWatchlists = payload.watchlists || [];
    renderWatchlistOptions(payload.activeWatchlist ?? currentScreenWatchlist);
    const requestedSymbols = payload.requestedSymbols || [];
    const recommendations = payload.recommendations || [];
    const skippedSymbols = payload.skippedSymbols || [];
    const recommendationBySymbol = new Map(recommendations.map((item) => [item.symbol, item]));
    const skippedBySymbol = new Map(skippedSymbols.map((item) => [item.symbol, item.error]));

    resultsEl.innerHTML = "";
    if (!requestedSymbols.length) {
      renderRecommendations([]);
    } else if (currentScreenWatchlist === "all") {
      emptyEl.classList.add("hidden");
      resultsEl.className = "grouped-layout";
      currentWatchlists.forEach((watchlist) => {
        const watchlistSymbols = watchlist.symbols || [];
        const entries = watchlistSymbols
          .filter((symbol) => requestedSymbols.includes(symbol))
          .map((symbol) => ({
            symbol,
            recommendation: recommendationBySymbol.get(symbol),
            error: skippedBySymbol.get(symbol),
          }));

        if (!entries.length) {
          return;
        }

        const { section, grid } = createGroupSection(
          watchlist.name,
          "Signals for this watchlist.",
          entries.length
        );
        entries.forEach((entry) => {
          if (entry.recommendation) {
            grid.appendChild(appendRecommendationCard(entry.recommendation));
          } else {
            grid.appendChild(renderSkippedRecommendationCard(entry.symbol, entry.error));
          }
        });
        resultsEl.appendChild(section);
      });
    } else if (currentScreenGroup === "signals") {
      emptyEl.classList.add("hidden");
      resultsEl.className = "grouped-layout";
      const groupDefinitions = [
        { key: "Strong Buy", title: "Strong Buy cluster", copy: "Highest conviction upside setups." },
        { key: "Buy", title: "Buy cluster", copy: "Constructive bullish signals that still need monitoring." },
        { key: "Watch", title: "Watch cluster", copy: "Mixed setups with enough signal to monitor closely." },
        { key: "No Trade", title: "No-trade cluster", copy: "Signals are too conflicted or weak to act on." },
        { key: "Sell", title: "Sell cluster", copy: "Bearish setups with moderate downside pressure." },
        { key: "Strong Sell", title: "Strong Sell cluster", copy: "Highest conviction downside setups." },
        { key: "Skipped", title: "Skipped / unavailable", copy: "Saved watchlist names that could not be classified." },
      ];
      const grouped = new Map(groupDefinitions.map((group) => [group.key, []]));

      requestedSymbols.forEach((symbol) => {
        const recommendation = recommendationBySymbol.get(symbol);
        if (recommendation) {
          grouped.get(recommendation.recommendation)?.push({
            type: "recommendation",
            recommendation,
          });
          return;
        }

        grouped.get("Skipped").push({
          type: "skipped",
          symbol,
          error: skippedBySymbol.get(symbol),
        });
      });

      groupDefinitions.forEach((group) => {
        const items = grouped.get(group.key) || [];
        if (!items.length) {
          return;
        }

        const { section, grid } = createGroupSection(group.title, group.copy, items.length);
        items.forEach((entry) => {
          if (entry.type === "recommendation") {
            grid.appendChild(appendRecommendationCard(entry.recommendation));
          } else {
            grid.appendChild(renderSkippedRecommendationCard(entry.symbol, entry.error));
          }
        });
        resultsEl.appendChild(section);
      });
    } else {
      resultsEl.className = "analysis-grid";
      emptyEl.classList.add("hidden");
      requestedSymbols.forEach((symbol) => {
        const recommendation = recommendationBySymbol.get(symbol);
        if (recommendation) {
          resultsEl.appendChild(appendRecommendationCard(recommendation));
          return;
        }

        resultsEl.appendChild(renderSkippedRecommendationCard(symbol, skippedBySymbol.get(symbol)));
      });
    }

    const warning = formatSkippedSymbols(payload.skippedSymbols);
    setStatus(recommendations.length ? `Screen updated. ${warning}`.trim() : warning);
  } catch (error) {
    resultsEl.innerHTML = "";
    emptyEl.classList.add("hidden");
    setStatus(error.message);
  } finally {
    runButton.disabled = false;
  }
}

async function loadBacktest() {
  backtestButton.disabled = true;
  exportBacktestButton.disabled = true;
  setBacktestStatus("Running rolling backtest...");

  try {
    const payload = await apiRequest(
      `/api/backtest/technical?watchlist=${encodeURIComponent(currentScreenWatchlist)}`
    );
    currentWatchlists = payload.watchlists || currentWatchlists;
    if (payload.activeWatchlist != null) {
      renderWatchlistOptions(payload.activeWatchlist);
    }
    renderBacktest(payload);
    const warning = formatSkippedSymbols(payload.skippedSymbols);
    setBacktestStatus(payload.symbols?.length ? `Backtest updated. ${warning}`.trim() : warning);
  } catch (error) {
    hasBacktestData = false;
    backtestSummaryEl.innerHTML = "";
    backtestDirectionsEl.innerHTML = "";
    backtestSymbolsEl.innerHTML = "";
    backtestEmptyEl.classList.add("hidden");
    setBacktestStatus(error.message);
  } finally {
    backtestButton.disabled = false;
    exportBacktestButton.disabled = false;
  }
}

function exportBacktestCsv() {
  if (!hasBacktestData) {
    setBacktestStatus("Run the backtest first, then export the results.");
    return;
  }

  exportBacktestButton.disabled = true;
  setBacktestStatus("Preparing CSV export...");
  window.location.assign(
    `/api/backtest/technical?watchlist=${encodeURIComponent(currentScreenWatchlist)}&format=csv`
  );
  window.setTimeout(() => {
    exportBacktestButton.disabled = false;
    setBacktestStatus("Backtest CSV requested.");
  }, 1200);
}

runButton.addEventListener("click", loadScreen);
backtestButton.addEventListener("click", loadBacktest);
exportBacktestButton.addEventListener("click", exportBacktestCsv);
screenWatchlistSelectEl.addEventListener("change", () => {
  currentScreenWatchlist = screenWatchlistSelectEl.value;
  saveScreenWatchlist(currentScreenWatchlist);
  loadScreen();
});
initScreenGroupTabs();
setBacktestStatus("Backtest is available on demand. Run it when you want validation metrics.");
loadScreen();
