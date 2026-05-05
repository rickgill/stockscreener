const form = document.querySelector("#add-form");
const input = document.querySelector("#symbol-input");
const cardsContainer = document.querySelector("#cards");
const statusEl = document.querySelector("#status");
const template = document.querySelector("#card-template");
const globalRangeTabsEl = document.querySelector("#global-range-tabs");
const dashboardGroupTabsEl = document.querySelector("#dashboard-group-tabs");
const addWatchlistSelectEl = document.querySelector("#add-watchlist-select");
const watchlistViewSelectEl = document.querySelector("#watchlist-view-select");
const createWatchlistButton = document.querySelector("#create-watchlist-button");
const deleteWatchlistButton = document.querySelector("#delete-watchlist-button");
const searchResultsEl = document.querySelector("#symbol-search-results");
const rangeStorageKey = "stock-dashboard-global-range";
const dashboardGroupStorageKey = "stock-dashboard-grouping";
const dashboardWatchlistStorageKey = "stock-dashboard-watchlist-view";
const rangePresets = [
  { key: "1d", label: "1D" },
  { key: "15d", label: "15D" },
  { key: "1mo", label: "1M" },
  { key: "3mo", label: "3M" },
  { key: "6mo", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "3y", label: "3Y" },
  { key: "5y", label: "5Y" },
  { key: "10y", label: "10Y" },
  { key: "max", label: "Max" },
];
const defaultRange = "1d";
const defaultDashboardGroup = "watchlist";
const autoRefreshMs = 10000;
const dashboardGroupModes = [
  { key: "watchlist", label: "Watchlist order" },
  { key: "trend", label: "Trend buckets" },
];

const cards = new Map();
const globalRangeButtons = new Map();
const dashboardGroupButtons = new Map();
let currentGlobalRange = loadRange();
let currentDashboardGroup = loadDashboardGroup();
let currentWatchlistView = loadWatchlistView();
let draggingSymbol = null;
let searchDebounceTimer = null;
let currentSearchResults = [];
let autoRefreshTimer = null;
let watchlistOrder = [];
let watchlists = [];

function setStatus(message) {
  statusEl.textContent = message || "";
}

function formatMoney(value, currency = "USD", digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatNumber(value, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }

  return `${value >= 0 ? "+" : ""}${formatNumber(value, digits)}%`;
}

function saveRange(range) {
  localStorage.setItem(rangeStorageKey, range);
}

function loadRange() {
  const value = localStorage.getItem(rangeStorageKey) || defaultRange;
  return rangePresets.some((preset) => preset.key === value) ? value : defaultRange;
}

function saveDashboardGroup(group) {
  localStorage.setItem(dashboardGroupStorageKey, group);
}

function loadDashboardGroup() {
  const value = localStorage.getItem(dashboardGroupStorageKey) || defaultDashboardGroup;
  return dashboardGroupModes.some((mode) => mode.key === value) ? value : defaultDashboardGroup;
}

function saveWatchlistView(value) {
  localStorage.setItem(dashboardWatchlistStorageKey, String(value));
}

function loadWatchlistView() {
  return localStorage.getItem(dashboardWatchlistStorageKey) || "";
}

function normalizeSymbol(symbol) {
  return symbol.trim().toUpperCase();
}

function getWatchlistOptionValue(watchlistId) {
  return watchlistId === "all" ? "all" : String(watchlistId);
}

function normalizeCurrentWatchlistView() {
  if (currentWatchlistView === "all" && watchlists.length > 1) {
    return;
  }

  const exists = watchlists.some((watchlist) => String(watchlist.id) === String(currentWatchlistView));
  if (!exists) {
    currentWatchlistView = watchlists[0] ? String(watchlists[0].id) : "all";
  }
}

function renderWatchlistControls() {
  normalizeCurrentWatchlistView();

  addWatchlistSelectEl.innerHTML = "";
  watchlistViewSelectEl.innerHTML = "";

  watchlists.forEach((watchlist) => {
    const addOption = document.createElement("option");
    addOption.value = String(watchlist.id);
    addOption.textContent = watchlist.name;
    addWatchlistSelectEl.appendChild(addOption);

    const viewOption = document.createElement("option");
    viewOption.value = String(watchlist.id);
    viewOption.textContent = watchlist.name;
    watchlistViewSelectEl.appendChild(viewOption);
  });

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All watchlists";
  watchlistViewSelectEl.insertBefore(allOption, watchlistViewSelectEl.firstChild);

  const selectedAddWatchlist =
    watchlists.find((watchlist) => String(watchlist.id) === String(currentWatchlistView)) || watchlists[0];
  if (selectedAddWatchlist) {
    addWatchlistSelectEl.value = String(selectedAddWatchlist.id);
  }

  watchlistViewSelectEl.value = getWatchlistOptionValue(currentWatchlistView);
  const selectedWatchlist = watchlists.find((watchlist) => String(watchlist.id) === String(currentWatchlistView));
  deleteWatchlistButton.disabled = !selectedWatchlist || selectedWatchlist.name === "Core";
}

function getWatchlistForSymbol(symbol) {
  return watchlists.find((watchlist) => watchlist.symbols.includes(symbol)) || null;
}

function getActiveWatchlistId() {
  return currentWatchlistView === "all" ? "all" : Number(currentWatchlistView);
}

function getRangeLabel(rangeKey) {
  return rangePresets.find((preset) => preset.key === rangeKey)?.label || rangeKey;
}

function formatTimestamp(value, rangeKey) {
  if (!value) {
    return "Unavailable";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  if (rangeKey === "1d") {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  if (rangeKey === "15d" || rangeKey === "1mo" || rangeKey === "3mo" || rangeKey === "6mo") {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatMarketTime(timestampSeconds) {
  if (!timestampSeconds) {
    return "Market time unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestampSeconds * 1000));
}

function buildXLabels(points, rangeKey) {
  if (!points.length) {
    return [];
  }

  const indexes = [
    0,
    Math.floor((points.length - 1) / 3),
    Math.floor(((points.length - 1) * 2) / 3),
    points.length - 1,
  ];

  return indexes.map((index) => formatTimestamp(points[index].timestamp || points[index].date, rangeKey));
}

function buildYLabels(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  return Array.from({ length: 4 }, (_, index) => ({
    value: max - (span * index) / 3,
    ratio: index / 3,
  }));
}

function drawChart(canvas, payload, sideLabelsEl, xLabelsEl, previousCloseEl, priceTagEl) {
  const points = payload.points;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.width;
  const cssHeight = Math.round(cssWidth * 0.42);
  const values = points.map((point) => point.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const latest = points[points.length - 1];
  const first = points[0];
  const delta = latest.close - first.close;
  const strokeColor = delta >= 0 ? "#188038" : "#d93025";

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = cssWidth;
  const height = cssHeight;
  const paddingTop = 10;
  const paddingBottom = 24;
  const chartHeight = height - paddingTop - paddingBottom;

  ctx.clearRect(0, 0, width, height);

  sideLabelsEl.innerHTML = "";
  buildYLabels(values).forEach((label) => {
    const y = paddingTop + chartHeight * label.ratio;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.strokeStyle = "#eceff1";
    ctx.lineWidth = 1;
    ctx.stroke();

    const el = document.createElement("span");
    el.className = "chart-y-label";
    el.style.top = `${y}px`;
    el.textContent = formatNumber(label.value, 0);
    sideLabelsEl.appendChild(el);
  });

  const linePoints = values.map((value, index) => ({
    x: (width * index) / Math.max(values.length - 1, 1),
    y: paddingTop + ((max - value) / span) * chartHeight,
  }));

  ctx.beginPath();
  linePoints.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();

  const previousClose = payload.stats.previousClose;
  if (previousClose != null && !Number.isNaN(previousClose) && previousClose >= min && previousClose <= max) {
    const y = paddingTop + ((max - previousClose) / span) * chartHeight;
    ctx.beginPath();
    ctx.setLineDash([2, 5]);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.strokeStyle = "#bdc1c6";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const last = linePoints[linePoints.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = strokeColor;
  ctx.fill();

  xLabelsEl.innerHTML = "";
  buildXLabels(points, payload.range).forEach((label) => {
    const el = document.createElement("span");
    el.textContent = label;
    xLabelsEl.appendChild(el);
  });

  previousCloseEl.textContent =
    previousClose != null && !Number.isNaN(previousClose)
      ? `Previous close\n${formatMoney(previousClose, payload.currency)}`
      : "";

  priceTagEl.textContent = `${formatMoney(latest.close, payload.currency)} ${formatTimestamp(
    latest.timestamp || latest.date,
    payload.range
  )}`;
}

function updateLogo(logoEl, symbol) {
  const letters = symbol.replace(/[^A-Z]/g, "").slice(0, 2) || symbol.slice(0, 2);
  logoEl.textContent = letters;
}

function updateGlobalRangeButtons() {
  globalRangeButtons.forEach((button, key) => {
    button.classList.toggle("active", key === currentGlobalRange);
    button.setAttribute("aria-pressed", String(key === currentGlobalRange));
  });
}

function setGlobalRange(range) {
  if (range === currentGlobalRange) {
    return;
  }

  currentGlobalRange = range;
  saveRange(range);
  updateGlobalRangeButtons();
  cards.forEach(({ setRange }) => setRange(range, { fromGlobal: true }));
  renderCards();
  setStatus(`Global range changed to ${getRangeLabel(range)}.`);
}

function initGlobalRangeTabs() {
  rangePresets.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "range-pill";
    button.textContent = preset.label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => setGlobalRange(preset.key));
    globalRangeButtons.set(preset.key, button);
    globalRangeTabsEl.appendChild(button);
  });
  updateGlobalRangeButtons();
}

function updateDashboardGroupButtons() {
  dashboardGroupButtons.forEach((button, key) => {
    button.classList.toggle("active", key === currentDashboardGroup);
    button.setAttribute("aria-pressed", String(key === currentDashboardGroup));
  });
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
      <span class="group-section-count">${count} ${count === 1 ? "name" : "names"}</span>
    </div>
  `;
  const grid = document.createElement("div");
  grid.className = "group-section-grid";
  section.appendChild(grid);
  return { section, grid };
}

function getTrendGroupMeta(state) {
  const payload = state.currentPayload;
  if (!payload?.points?.length) {
    return {
      key: "pending",
      title: "Pending / unavailable",
      copy: "Cards still loading or waiting on enough market data.",
    };
  }

  const first = payload.points[0];
  const latest = payload.points[payload.points.length - 1];
  const rangeReturnPct = first?.close ? ((latest.close - first.close) / first.close) * 100 : 0;

  if (rangeReturnPct >= 3) {
    return {
      key: "leaders",
      title: `${getRangeLabel(currentGlobalRange)} leaders`,
      copy: "Names showing the strongest upside momentum over the active chart window.",
    };
  }

  if (rangeReturnPct <= -3) {
    return {
      key: "laggards",
      title: `${getRangeLabel(currentGlobalRange)} laggards`,
      copy: "Names trading weakest over the active chart window.",
    };
  }

  return {
    key: "mixed",
    title: `${getRangeLabel(currentGlobalRange)} mixed`,
    copy: "Names moving sideways or lacking a decisive range signal.",
  };
}

function setCardDragState(cardEl, enabled) {
  cardEl.draggable = enabled;
  cardEl.style.cursor = enabled ? "grab" : "default";
}

function renderCards() {
  cardsContainer.innerHTML = "";

  if (!watchlistOrder.length) {
    cardsContainer.className = "cards";
    return;
  }

  const orderedCards = watchlistOrder.map((symbol) => cards.get(symbol)).filter(Boolean);

  if (currentWatchlistView === "all") {
    cardsContainer.className = "grouped-layout";
    watchlists.forEach((watchlist) => {
      const items = orderedCards.filter((state) => state.watchlistId === watchlist.id);
      if (!items.length) {
        return;
      }

      const { section, grid } = createGroupSection(
        watchlist.name,
        "Saved members of this watchlist.",
        items.length
      );
      items.forEach((state) => {
        setCardDragState(state.cardEl, false);
        grid.appendChild(state.cardEl);
      });
      cardsContainer.appendChild(section);
    });
    return;
  }

  if (currentDashboardGroup === "watchlist") {
    cardsContainer.className = "cards";
    orderedCards.forEach((state) => {
      setCardDragState(state.cardEl, true);
      cardsContainer.appendChild(state.cardEl);
    });
    return;
  }

  cardsContainer.className = "grouped-layout";
  const orderedKeys = ["leaders", "mixed", "laggards", "pending"];
  const groupedStates = new Map(orderedKeys.map((key) => [key, []]));

  orderedCards.forEach((state) => {
    setCardDragState(state.cardEl, false);
    const meta = getTrendGroupMeta(state);
    groupedStates.get(meta.key).push({ state, meta });
  });

  orderedKeys.forEach((key) => {
    const items = groupedStates.get(key) || [];
    if (!items.length) {
      return;
    }

    const { title, copy } = items[0].meta;
    const { section, grid } = createGroupSection(title, copy, items.length);
    items.forEach(({ state }) => grid.appendChild(state.cardEl));
    cardsContainer.appendChild(section);
  });

  const note = document.createElement("p");
  note.className = "group-lock-note";
  note.textContent = `Grouped by ${getRangeLabel(currentGlobalRange)} behavior. Switch back to watchlist order to drag and persist a new sequence.`;
  cardsContainer.appendChild(note);
}

function setDashboardGroup(group) {
  if (group === currentDashboardGroup) {
    return;
  }

  currentDashboardGroup = group;
  saveDashboardGroup(group);
  updateDashboardGroupButtons();
  renderCards();
  setStatus(group === "trend" ? "Dashboard grouped by shared range behavior." : "Dashboard returned to watchlist order.");
}

function initDashboardGroupTabs() {
  dashboardGroupModes.forEach((mode) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-pill";
    button.textContent = mode.label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => setDashboardGroup(mode.key));
    dashboardGroupButtons.set(mode.key, button);
    dashboardGroupTabsEl.appendChild(button);
  });
  updateDashboardGroupButtons();
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function clearSearchResults() {
  currentSearchResults = [];
  searchResultsEl.innerHTML = "";
  searchResultsEl.classList.remove("visible");
}

function renderSearchResults(results) {
  currentSearchResults = results;
  searchResultsEl.innerHTML = "";

  if (!results.length) {
    searchResultsEl.classList.remove("visible");
    return;
  }

  results.forEach((result) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "symbol-search-result";
    button.innerHTML = `
      <span class="symbol-search-primary">${result.symbol}</span>
      <span class="symbol-search-secondary">${result.shortName}${result.exchange ? ` - ${result.exchange}` : ""}</span>
    `;
    button.addEventListener("click", () => {
      input.value = result.symbol;
      clearSearchResults();
      addSymbol(result.symbol);
      input.focus();
    });
    searchResultsEl.appendChild(button);
  });

  searchResultsEl.classList.add("visible");
}

async function searchSymbols(query) {
  if (query.trim().length < 1) {
    clearSearchResults();
    return;
  }

  try {
    const payload = await apiRequest(`/api/symbol-search?q=${encodeURIComponent(query.trim())}`);
    renderSearchResults(payload.results || []);
  } catch (error) {
    setStatus(error.message);
    clearSearchResults();
  }
}

function getCurrentCardOrder() {
  return [...watchlistOrder];
}

function startAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }

  autoRefreshTimer = window.setInterval(() => {
    cards.forEach(({ refresh }) => {
      refresh({ background: true });
    });
  }, autoRefreshMs);
}

async function persistCardOrder() {
  const symbols = getCurrentCardOrder();
  await apiRequest("/api/symbols/order", {
    method: "PUT",
    body: JSON.stringify({ watchlistId: getActiveWatchlistId(), symbols }),
  });
}

function makeCard(symbol) {
  const fragment = template.content.cloneNode(true);
  const cardEl = fragment.querySelector(".quote-card");
  const logoEl = fragment.querySelector(".logo-mark");
  const symbolEl = fragment.querySelector(".symbol");
  const nameEl = fragment.querySelector(".name");
  const metaEl = fragment.querySelector(".meta");
  const latestPriceEl = fragment.querySelector(".latest-price");
  const currencyEl = fragment.querySelector(".currency");
  const changeEl = fragment.querySelector(".change");
  const marketTimeEl = fragment.querySelector(".market-time");
  const rangeTabsEl = fragment.querySelector(".range-tabs");
  const rangeLabelEl = fragment.querySelector(".range-label");
  const errorEl = fragment.querySelector(".error-message");
  const moveSelectEl = fragment.querySelector(".watchlist-move-select");
  const moveButton = fragment.querySelector(".move-button");
  const removeButton = fragment.querySelector(".remove-button");
  const canvas = fragment.querySelector(".chart");
  const sideLabelsEl = fragment.querySelector(".chart-side-labels");
  const xLabelsEl = fragment.querySelector(".chart-x-labels");
  const previousCloseEl = fragment.querySelector(".chart-previous-close");
  const priceTagEl = fragment.querySelector(".price-tag");
  const metricOpenEl = fragment.querySelector(".metric-open");
  const metricPrevCloseEl = fragment.querySelector(".metric-prev-close");
  const metricDayHighEl = fragment.querySelector(".metric-day-high");
  const metricDayLowEl = fragment.querySelector(".metric-day-low");
  const metric52HighEl = fragment.querySelector(".metric-52-high");
  const metric52LowEl = fragment.querySelector(".metric-52-low");
  const metricRangeStartEl = fragment.querySelector(".metric-range-start");
  const metricPointsEl = fragment.querySelector(".metric-points");
  const localRangeButtons = new Map();
  let currentPayload = null;
  let currentRange = currentGlobalRange;
  let isRefreshing = false;
  const watchlist = getWatchlistForSymbol(symbol);

  cardEl.dataset.symbol = symbol;
  updateLogo(logoEl, symbol);
  symbolEl.textContent = symbol;
  nameEl.textContent = "Loading...";
  metaEl.textContent = "Exchange";
  rangeLabelEl.textContent = `Fetching ${getRangeLabel(currentRange)}`;

  function updateLocalRangeButtons() {
    localRangeButtons.forEach((button, key) => {
      button.classList.toggle("active", key === currentRange);
      button.setAttribute("aria-pressed", String(key === currentRange));
    });
  }

  function resetMetrics() {
    metricOpenEl.textContent = "N/A";
    metricPrevCloseEl.textContent = "N/A";
    metricDayHighEl.textContent = "N/A";
    metricDayLowEl.textContent = "N/A";
    metric52HighEl.textContent = "N/A";
    metric52LowEl.textContent = "N/A";
    metricRangeStartEl.textContent = "N/A";
    metricPointsEl.textContent = "0";
  }

  function renderMoveControls() {
    moveSelectEl.innerHTML = "";
    const targetWatchlists = watchlists.filter((item) => item.id !== watchlist?.id);
    moveButton.disabled = targetWatchlists.length === 0;
    moveSelectEl.disabled = targetWatchlists.length === 0;

    if (!targetWatchlists.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Only watchlist";
      moveSelectEl.appendChild(option);
      return;
    }

    targetWatchlists.forEach((item) => {
      const option = document.createElement("option");
      option.value = String(item.id);
      option.textContent = item.name;
      moveSelectEl.appendChild(option);
    });
  }

  async function refresh(options = {}) {
    if (isRefreshing) {
      return;
    }

    isRefreshing = true;
    errorEl.textContent = "";
    if (!options.background) {
      rangeLabelEl.textContent = `Refreshing ${getRangeLabel(currentRange)}`;
    }

    try {
      const payload = await apiRequest(
        `/api/history?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(currentRange)}`
      );

      currentPayload = payload;
      const latest = payload.points[payload.points.length - 1];
      const first = payload.points[0];
      const delta = latest.close - first.close;
      const deltaPct = (delta / first.close) * 100;

      nameEl.textContent = payload.shortName || symbol;
      metaEl.textContent = payload.exchange || "Market";
      latestPriceEl.textContent = formatNumber(latest.close, 2);
      currencyEl.textContent = payload.currency || "USD";
      changeEl.textContent = `${formatMoney(delta, payload.currency)} (${formatPercent(deltaPct).replace("+", "")})`;
      changeEl.classList.toggle("positive", delta >= 0);
      changeEl.classList.toggle("negative", delta < 0);
      marketTimeEl.textContent = formatMarketTime(payload.regularMarketTime);
      metricOpenEl.textContent = formatMoney(payload.stats.open, payload.currency);
      metricPrevCloseEl.textContent = formatMoney(payload.stats.previousClose, payload.currency);
      metricDayHighEl.textContent = formatMoney(payload.stats.dayHigh, payload.currency);
      metricDayLowEl.textContent = formatMoney(payload.stats.dayLow, payload.currency);
      metric52HighEl.textContent = formatMoney(payload.stats.fiftyTwoWeekHigh, payload.currency);
      metric52LowEl.textContent = formatMoney(payload.stats.fiftyTwoWeekLow, payload.currency);
      metricRangeStartEl.textContent = first.date;
      metricPointsEl.textContent = payload.points.length.toLocaleString();
      rangeLabelEl.textContent = `${getRangeLabel(payload.range)} | ${first.date} to ${latest.date}`;
      drawChart(canvas, payload, sideLabelsEl, xLabelsEl, previousCloseEl, priceTagEl);
      renderCards();
    } catch (error) {
      nameEl.textContent = symbol;
      metaEl.textContent = "";
      latestPriceEl.textContent = "N/A";
      currencyEl.textContent = "";
      changeEl.textContent = "N/A";
      marketTimeEl.textContent = "Market time unavailable";
      priceTagEl.textContent = "";
      rangeLabelEl.textContent = "No chart available";
      previousCloseEl.textContent = "";
      xLabelsEl.innerHTML = "";
      sideLabelsEl.innerHTML = "";
      errorEl.textContent = error.message;
      resetMetrics();
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      renderCards();
    } finally {
      isRefreshing = false;
      updateLocalRangeButtons();
    }
  }

  function setRange(range, options = {}) {
    if (range === currentRange && !options.force) {
      return;
    }

    currentRange = range;
    updateLocalRangeButtons();
    refresh();
  }

  rangePresets.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "range-pill range-pill-local";
    button.textContent = preset.label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => setRange(preset.key));
    localRangeButtons.set(preset.key, button);
    rangeTabsEl.appendChild(button);
  });
  updateLocalRangeButtons();
  renderMoveControls();

  moveButton.addEventListener("click", async () => {
    const targetWatchlistId = Number(moveSelectEl.value);
    if (!targetWatchlistId) {
      setStatus("Choose a target watchlist first.");
      return;
    }

    try {
      await apiRequest("/api/symbols", {
        method: "POST",
        body: JSON.stringify({ symbol, watchlistId: targetWatchlistId }),
      });
      await loadDashboardSymbols();
      const targetName = watchlists.find((item) => item.id === targetWatchlistId)?.name || "selected watchlist";
      setStatus(`${symbol} moved to ${targetName}.`);
    } catch (error) {
      setStatus(error.message);
    }
  });

  removeButton.addEventListener("click", async () => {
    try {
      await apiRequest(
        `/api/symbols/${encodeURIComponent(symbol)}?watchlist=${encodeURIComponent(getWatchlistOptionValue(currentWatchlistView))}`,
        { method: "DELETE" }
      );
      cards.delete(symbol);
      watchlistOrder = watchlistOrder.filter((value) => value !== symbol);
      cardEl.remove();
      await loadDashboardSymbols();
      setStatus(`${symbol} removed.`);
    } catch (error) {
      setStatus(error.message);
    }
  });

  cardEl.addEventListener("dragstart", (event) => {
    if (currentDashboardGroup !== "watchlist" || currentWatchlistView === "all") {
      event.preventDefault();
      return;
    }
    draggingSymbol = symbol;
    cardEl.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", symbol);
  });

  cardEl.addEventListener("dragend", () => {
    draggingSymbol = null;
    cardEl.classList.remove("dragging");
    cardsContainer.querySelectorAll(".quote-card").forEach((card) => card.classList.remove("drag-over"));
  });

  cardEl.addEventListener("dragover", (event) => {
    if (currentDashboardGroup !== "watchlist" || currentWatchlistView === "all") {
      return;
    }
    if (!draggingSymbol || draggingSymbol === symbol) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    cardEl.classList.add("drag-over");
  });

  cardEl.addEventListener("dragleave", () => {
    cardEl.classList.remove("drag-over");
  });

  cardEl.addEventListener("drop", async (event) => {
    if (currentDashboardGroup !== "watchlist" || currentWatchlistView === "all") {
      return;
    }
    if (!draggingSymbol || draggingSymbol === symbol) {
      return;
    }

    event.preventDefault();
    cardEl.classList.remove("drag-over");

    const draggedCard = cards.get(draggingSymbol)?.cardEl;
    const targetCard = cards.get(symbol)?.cardEl;
    if (!draggedCard || !targetCard || draggedCard === targetCard) {
      return;
    }

    const targetRect = targetCard.getBoundingClientRect();
    const insertAfter = event.clientY > targetRect.top + targetRect.height / 2;
    if (insertAfter) {
      targetCard.insertAdjacentElement("afterend", draggedCard);
    } else {
      targetCard.insertAdjacentElement("beforebegin", draggedCard);
    }

    try {
      watchlistOrder = Array.from(cardsContainer.querySelectorAll(".quote-card")).map((card) => card.dataset.symbol);
      await persistCardOrder();
      setStatus(`Moved ${draggingSymbol}.`);
    } catch (error) {
      setStatus(error.message);
    }
  });

  cards.set(symbol, {
    symbol,
    watchlistId: watchlist?.id ?? null,
    refresh,
    setRange,
    cardEl,
    get currentPayload() {
      return currentPayload;
    },
    redraw() {
      if (currentPayload) {
        drawChart(canvas, currentPayload, sideLabelsEl, xLabelsEl, previousCloseEl, priceTagEl);
      }
    },
  });
  if (!watchlistOrder.includes(symbol)) {
    watchlistOrder.push(symbol);
  }
  renderCards();
  resetMetrics();
  refresh();
}

async function addSymbol(rawSymbol) {
  const symbol = normalizeSymbol(rawSymbol);
  const watchlistId = Number(addWatchlistSelectEl.value);
  if (!symbol) {
    setStatus("Enter a stock symbol first.");
    return;
  }

  try {
    await apiRequest("/api/symbols", {
      method: "POST",
      body: JSON.stringify({ symbol, watchlistId }),
    });
    await loadDashboardSymbols();
    setStatus(`${symbol} added.`);
    clearSearchResults();
  } catch (error) {
    setStatus(error.message);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  addSymbol(input.value);
  input.value = "";
  clearSearchResults();
  input.focus();
});

input.addEventListener("input", () => {
  const query = input.value;
  clearTimeout(searchDebounceTimer);
  if (!query.trim()) {
    clearSearchResults();
    return;
  }

  searchDebounceTimer = setTimeout(() => {
    searchSymbols(query);
  }, 250);
});

input.addEventListener("blur", () => {
  setTimeout(() => clearSearchResults(), 150);
});

input.addEventListener("focus", () => {
  if (currentSearchResults.length > 0) {
    searchResultsEl.classList.add("visible");
  }
});

window.addEventListener("resize", () => {
  cards.forEach(({ redraw }) => redraw());
});

async function loadDashboardSymbols() {
  const payload = await apiRequest(`/api/symbols?watchlist=${encodeURIComponent(getWatchlistOptionValue(currentWatchlistView))}`);
  watchlists = payload.watchlists || [];
  currentWatchlistView = String(payload.activeWatchlist);
  saveWatchlistView(currentWatchlistView);
  renderWatchlistControls();

  cards.clear();
  cardsContainer.innerHTML = "";
  watchlistOrder = [...(payload.symbols || [])];

  if (watchlistOrder.length > 0) {
    watchlistOrder.forEach((symbol) => makeCard(symbol));
  } else {
    renderCards();
    setStatus(
      currentWatchlistView === "all"
        ? "No saved symbols yet. Create a watchlist and add your first symbol."
        : "This watchlist is empty. Search for a company or ticker to add a symbol."
    );
  }
}

async function init() {
  initGlobalRangeTabs();
  initDashboardGroupTabs();
  startAutoRefresh();

  try {
    await loadDashboardSymbols();
  } catch (error) {
    setStatus(error.message);
  }
}

watchlistViewSelectEl.addEventListener("change", async () => {
  currentWatchlistView = watchlistViewSelectEl.value;
  saveWatchlistView(currentWatchlistView);
  try {
    await loadDashboardSymbols();
    setStatus(
      currentWatchlistView === "all"
        ? "Viewing all watchlists grouped together."
        : `Viewing ${watchlists.find((watchlist) => String(watchlist.id) === String(currentWatchlistView))?.name || "selected watchlist"}.`
    );
  } catch (error) {
    setStatus(error.message);
  }
});

createWatchlistButton.addEventListener("click", async () => {
  const name = window.prompt("New watchlist name");
  if (!name) {
    return;
  }

  try {
    const payload = await apiRequest("/api/watchlists", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    watchlists = payload.watchlists || [];
    currentWatchlistView = String(watchlists[watchlists.length - 1]?.id || currentWatchlistView);
    saveWatchlistView(currentWatchlistView);
    await loadDashboardSymbols();
    setStatus(`Watchlist ${name.trim()} created.`);
  } catch (error) {
    setStatus(error.message);
  }
});

deleteWatchlistButton.addEventListener("click", async () => {
  const selectedWatchlist = watchlists.find((watchlist) => String(watchlist.id) === String(currentWatchlistView));
  if (!selectedWatchlist) {
    setStatus("Choose a specific watchlist first.");
    return;
  }

  if (selectedWatchlist.name === "Core") {
    setStatus("The Core watchlist cannot be deleted.");
    return;
  }

  const confirmed = window.confirm(
    `Delete ${selectedWatchlist.name}? Its symbols will be moved back to Core.`
  );
  if (!confirmed) {
    return;
  }

  try {
    const payload = await apiRequest(`/api/watchlists/${selectedWatchlist.id}`, {
      method: "DELETE",
    });
    watchlists = payload.watchlists || [];
    currentWatchlistView = "all";
    saveWatchlistView(currentWatchlistView);
    await loadDashboardSymbols();
    setStatus(
      payload.movedSymbols?.length
        ? `${selectedWatchlist.name} deleted. ${payload.movedSymbols.join(", ")} moved to Core.`
        : `${selectedWatchlist.name} deleted.`
    );
  } catch (error) {
    setStatus(error.message);
  }
});

init();
