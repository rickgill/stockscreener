const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3040;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "stock-screener.sqlite");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml; charset=utf-8",
};

const RANGE_CONFIG = {
  "1d": { range: "1d", interval: "5m" },
  "15d": { days: 15, interval: "1d" },
  "1mo": { range: "1mo", interval: "1d" },
  "3mo": { range: "3mo", interval: "1d" },
  "6mo": { range: "6mo", interval: "1d" },
  "1y": { range: "1y", interval: "1d" },
  "3y": { days: 365 * 3, interval: "1d" },
  "5y": { days: 365 * 5, interval: "1d" },
  "10y": { days: 365 * 10, interval: "1wk" },
  max: { period1: 0, interval: "1wk" },
};
const YAHOO_CHART_HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
];
const YAHOO_SEARCH_HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
];
const STATIC_ROUTE_ALIASES = {
  "/": "/index.html",
  "/dashboard": "/dashboard.html",
  "/screener": "/screener.html",
  "/short-term": "/short-term.html",
  "/market-chat": "/market-chat.html",
  "/institutional-flow": "/institutional-flow.html",
  "/trending": "/trending.html",
};
const MARKET_FLOW_UNIVERSE = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "AMD",
  "AVGO",
  "NFLX",
  "PLTR",
  "SMCI",
  "MU",
  "ARM",
  "JPM",
  "BAC",
  "WFC",
  "GS",
  "XOM",
  "CVX",
  "LLY",
  "UNH",
  "COST",
  "WMT",
  "ORCL",
  "CRM",
  "UBER",
  "SHOP",
  "RIVN",
  "COIN",
];
const BACKTEST_LOOKBACK_RANGE = "3y";
const BACKTEST_TRANSACTION_COST_PCT = 0.4;
const BENCHMARKS = {
  broad: "SPY",
  growth: "QQQ",
};
const SECTOR_BENCHMARKS = {
  AAPL: "XLK",
  MSFT: "XLK",
  NVDA: "XLK",
  AVGO: "XLK",
  ORCL: "XLK",
  CRM: "XLK",
  AMD: "XLK",
  MU: "XLK",
  ARM: "XLK",
  PLTR: "XLK",
  SMCI: "XLK",
  AMZN: "XLY",
  TSLA: "XLY",
  NFLX: "XLC",
  GOOGL: "XLC",
  META: "XLC",
  SHOP: "XLY",
  UBER: "XLY",
  RIVN: "XLY",
  JPM: "XLF",
  BAC: "XLF",
  WFC: "XLF",
  GS: "XLF",
  XOM: "XLE",
  CVX: "XLE",
  LLY: "XLV",
  UNH: "XLV",
  COST: "XLP",
  WMT: "XLP",
  COIN: "XLF",
};
const DEFAULT_WATCHLIST_NAME = "Core";

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS symbols (
    symbol TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sort_order INTEGER
  )
`);
try {
  db.exec("ALTER TABLE symbols ADD COLUMN sort_order INTEGER");
} catch (error) {
  if (!String(error.message || error).includes("duplicate column name")) {
    throw error;
  }
}
db.exec(`
  UPDATE symbols
  SET sort_order = (
    SELECT COUNT(*)
    FROM symbols AS s2
    WHERE s2.created_at < symbols.created_at
       OR (s2.created_at = symbols.created_at AND s2.symbol <= symbols.symbol)
  )
  WHERE sort_order IS NULL
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS watchlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sort_order INTEGER
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS watchlist_symbols (
    watchlist_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sort_order INTEGER,
    PRIMARY KEY (watchlist_id, symbol),
    FOREIGN KEY (watchlist_id) REFERENCES watchlists(id) ON DELETE CASCADE
  )
`);
const existingDefaultWatchlist = db.prepare("SELECT id FROM watchlists WHERE name = ?").get(DEFAULT_WATCHLIST_NAME);
if (!existingDefaultWatchlist) {
  db.prepare("INSERT INTO watchlists (name, sort_order) VALUES (?, 1)").run(DEFAULT_WATCHLIST_NAME);
}
db.exec(`
  UPDATE watchlists
  SET sort_order = (
    SELECT COUNT(*)
    FROM watchlists AS w2
    WHERE w2.created_at < watchlists.created_at
       OR (w2.created_at = watchlists.created_at AND w2.id <= watchlists.id)
  )
  WHERE sort_order IS NULL
`);
const defaultWatchlist = db.prepare("SELECT id FROM watchlists WHERE name = ?").get(DEFAULT_WATCHLIST_NAME);
const legacySymbols = db
  .prepare("SELECT symbol, sort_order FROM symbols ORDER BY sort_order ASC, created_at ASC, symbol ASC")
  .all();
legacySymbols.forEach((row, index) => {
  db.prepare(
    "INSERT OR IGNORE INTO watchlist_symbols (watchlist_id, symbol, sort_order) VALUES (?, ?, ?)"
  ).run(defaultWatchlist.id, row.symbol, row.sort_order ?? index + 1);
});
db.exec(`
  UPDATE watchlist_symbols
  SET sort_order = (
    SELECT COUNT(*)
    FROM watchlist_symbols AS ws2
    WHERE ws2.watchlist_id = watchlist_symbols.watchlist_id
      AND (
        ws2.created_at < watchlist_symbols.created_at
        OR (ws2.created_at = watchlist_symbols.created_at AND ws2.symbol <= watchlist_symbols.symbol)
      )
  )
  WHERE sort_order IS NULL
`);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendCsv(res, statusCode, filename, content) {
  res.writeHead(statusCode, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  res.end(content);
}

function safeSymbol(rawSymbol) {
  return String(rawSymbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-^=]/g, "");
}

function safeRange(rawRange) {
  const normalized = String(rawRange || "").trim().toLowerCase();
  return RANGE_CONFIG[normalized] ? normalized : "6mo";
}

function safeSearchQuery(rawQuery) {
  return String(rawQuery || "").trim().slice(0, 50);
}

function safeWatchlistName(rawName) {
  return String(rawName || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

function normalizeWatchlistId(rawWatchlistId) {
  if (rawWatchlistId == null || rawWatchlistId === "" || rawWatchlistId === "all") {
    return "all";
  }

  const parsed = Number(rawWatchlistId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function listWatchlists() {
  return db
    .prepare(
      `
        SELECT
          w.id,
          w.name,
          w.sort_order,
          COALESCE(
            json_group_array(
              json_object(
                'symbol', ws.symbol,
                'sort_order', ws.sort_order
              )
            ) FILTER (WHERE ws.symbol IS NOT NULL),
            json('[]')
          ) AS symbols_json
        FROM watchlists w
        LEFT JOIN watchlist_symbols ws
          ON ws.watchlist_id = w.id
        GROUP BY w.id, w.name, w.sort_order
        ORDER BY w.sort_order ASC, w.created_at ASC, w.id ASC
      `
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      sortOrder: row.sort_order,
      symbols: JSON.parse(row.symbols_json)
        .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
        .map((entry) => entry.symbol),
    }));
}

function getWatchlistById(watchlistId) {
  return listWatchlists().find((watchlist) => watchlist.id === watchlistId) || null;
}

function getDefaultWatchlist() {
  return listWatchlists().find((watchlist) => watchlist.name === DEFAULT_WATCHLIST_NAME) || null;
}

function listStoredSymbols(watchlistId = "all") {
  const watchlists = listWatchlists();
  if (watchlistId === "all") {
    return [...new Set(watchlists.flatMap((watchlist) => watchlist.symbols))];
  }

  return watchlists.find((watchlist) => watchlist.id === watchlistId)?.symbols || [];
}

function getNextWatchlistSortOrder() {
  const row = db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM watchlists").get();
  return row.next_order;
}

function getNextSymbolSortOrder(watchlistId) {
  const row = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM watchlist_symbols WHERE watchlist_id = ?")
    .get(watchlistId);
  return row.next_order;
}

function replaceSymbolOrder(watchlistId, symbols) {
  const updateStmt = db.prepare("UPDATE watchlist_symbols SET sort_order = ? WHERE watchlist_id = ? AND symbol = ?");
  symbols.forEach((symbol, index) => {
    updateStmt.run(index + 1, watchlistId, symbol);
  });
}

function formatChartData(symbol, range, chart) {
  const result = chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const volumes = quote.volume || [];

  const points = timestamps
    .map((timestamp, index) => {
      const close = closes[index];
      if (close == null || Number.isNaN(close)) {
        return null;
      }

      return {
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        timestamp: new Date(timestamp * 1000).toISOString(),
        open: opens[index] ?? null,
        high: highs[index] ?? null,
        low: lows[index] ?? null,
        close,
        volume: volumes[index] ?? null,
      };
    })
    .filter(Boolean);

  if (points.length === 0) {
    throw new Error(`No historical data returned for ${symbol}.`);
  }

  const meta = result?.meta || {};
  const latest = points[points.length - 1];
  const first = points[0];

  return {
    symbol,
    shortName: meta.shortName || meta.longName || symbol,
    exchange: meta.fullExchangeName || meta.exchangeName || "",
    currency: meta.currency || "USD",
    firstTradeDate: meta.firstTradeDate
      ? new Date(meta.firstTradeDate * 1000).toISOString().slice(0, 10)
      : first.date,
    regularMarketPrice: meta.regularMarketPrice ?? latest.close,
    regularMarketTime: meta.regularMarketTime ?? null,
    previousClose: meta.chartPreviousClose ?? null,
    dataGranularity: meta.dataGranularity || "1d",
    stats: {
      open: latest.open ?? null,
      dayHigh: meta.regularMarketDayHigh ?? latest.high ?? null,
      dayLow: meta.regularMarketDayLow ?? latest.low ?? null,
      previousClose: meta.previousClose ?? meta.chartPreviousClose ?? null,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
    },
    range,
    points,
  };
}

function buildHistoryUrl(baseUrl, symbol, rangeConfig) {
  const target = new URL(`${baseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}`);
  const nowInSeconds = Math.floor(Date.now() / 1000);

  if (rangeConfig.range) {
    target.searchParams.set("range", rangeConfig.range);
  } else {
    const period1 = rangeConfig.period1 ?? nowInSeconds - rangeConfig.days * 24 * 60 * 60;
    target.searchParams.set("period1", String(period1));
    target.searchParams.set("period2", String(nowInSeconds));
  }

  target.searchParams.set("interval", rangeConfig.interval);
  target.searchParams.set("includePrePost", "false");
  target.searchParams.set("events", "div,splits");

  return target;
}

async function fetchHistoryFromUrl(target) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Data request failed with status ${response.status}.`);
    }

    const payload = await response.json();
    const error = payload?.chart?.error;
    if (error) {
      throw new Error(error.description || "Unknown upstream error.");
    }

    return payload.chart;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHistory(symbol, range) {
  const rangeConfig = RANGE_CONFIG[range] || RANGE_CONFIG["6mo"];
  const errors = [];

  for (const baseUrl of YAHOO_CHART_HOSTS) {
    const target = buildHistoryUrl(baseUrl, symbol, rangeConfig);
    try {
      const chart = await fetchHistoryFromUrl(target);
      return formatChartData(symbol, range, chart);
    } catch (error) {
      const message = error.name === "AbortError" ? "Upstream request timed out." : error.message;
      errors.push(`${baseUrl}: ${message}`);
      console.error(`[history] ${symbol} ${range} failed via ${baseUrl}: ${message}`);
    }
  }

  throw new Error(`Unable to load market data. ${errors.join(" | ")}`);
}

async function tryFetchHistory(symbol, range) {
  try {
    const history = await fetchHistory(symbol, range);
    return { ok: true, symbol, history };
  } catch (error) {
    return {
      ok: false,
      symbol,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildSearchUrl(baseUrl, query, options = {}) {
  const target = new URL(`${baseUrl}/v1/finance/search`);
  target.searchParams.set("q", query);
  target.searchParams.set("quotesCount", String(options.quotesCount ?? 8));
  target.searchParams.set("newsCount", String(options.newsCount ?? 0));
  target.searchParams.set("enableFuzzyQuery", "false");
  target.searchParams.set("quotesQueryId", "tss_match_phrase_query");
  target.searchParams.set("multiQuoteQueryId", "multi_quote_single_token_query");
  target.searchParams.set("enableEnhancedTrivialQuery", "true");
  return target;
}

async function fetchSearchPayload(query, options = {}) {
  const errors = [];

  for (const baseUrl of YAHOO_SEARCH_HOSTS) {
    const target = buildSearchUrl(baseUrl, query, options);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(target, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Search request failed with status ${response.status}.`);
        }

        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const message = error.name === "AbortError" ? "Upstream request timed out." : error.message;
      errors.push(`${baseUrl}: ${message}`);
      console.error(`[symbol-search] ${query} failed via ${baseUrl}: ${message}`);
    }
  }

  throw new Error(`Unable to search data. ${errors.join(" | ")}`);
}

async function fetchSearchResults(query) {
  const payload = await fetchSearchPayload(query, { quotesCount: 8, newsCount: 0 });
  return (payload.quotes || [])
    .filter((quote) => quote.symbol && !quote.symbol.includes("="))
    .map((quote) => ({
      symbol: quote.symbol,
      shortName: quote.shortname || quote.longname || quote.symbol,
      exchange: quote.exchange || quote.exchDisp || "",
      type: quote.quoteType || "",
    }));
}

function getNumber(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "object" && value.raw != null) {
    return getNumber(value.raw);
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getText(value) {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "object" && value.fmt) {
    return String(value.fmt).trim();
  }

  if (typeof value === "object" && value.longFmt) {
    return String(value.longFmt).trim();
  }

  if (typeof value === "object" && value.raw != null) {
    return String(value.raw).trim();
  }

  return String(value).trim();
}

function average(values) {
  const nums = values.map(getNumber).filter((value) => value != null);
  if (!nums.length) {
    return null;
  }

  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function sma(values, period) {
  if (values.length < period) {
    return null;
  }

  return average(values.slice(-period));
}

function ema(values, period) {
  if (values.length < period) {
    return null;
  }

  const multiplier = 2 / (period + 1);
  let value = average(values.slice(0, period));

  for (let index = period; index < values.length; index += 1) {
    value = values[index] * multiplier + value * (1 - multiplier);
  }

  return value;
}

function emaSeries(values, period) {
  if (values.length < period) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  const output = [];
  let value = average(values.slice(0, period));
  output[period - 1] = value;

  for (let index = period; index < values.length; index += 1) {
    value = values[index] * multiplier + value * (1 - multiplier);
    output[index] = value;
  }

  return output;
}

function rsi(values, period = 14) {
  if (values.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function standardDeviation(values) {
  const nums = values.map(getNumber).filter((value) => value != null);
  if (!nums.length) {
    return null;
  }

  const mean = average(nums);
  const variance = nums.reduce((sum, value) => sum + (value - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

function computeMacd(values) {
  if (values.length < 35) {
    return { macdLine: null, signalLine: null, histogram: null };
  }

  const fastSeries = emaSeries(values, 12);
  const slowSeries = emaSeries(values, 26);
  const macdSeries = values
    .map((_, index) => {
      if (fastSeries[index] == null || slowSeries[index] == null) {
        return null;
      }
      return fastSeries[index] - slowSeries[index];
    })
    .filter((value) => value != null);

  const signalLine = ema(macdSeries, 9);
  const macdLine = macdSeries[macdSeries.length - 1] ?? null;
  return {
    macdLine,
    signalLine,
    histogram: macdLine != null && signalLine != null ? macdLine - signalLine : null,
  };
}

function formatPercent(value, digits = 1) {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }

  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function buildFlowSnapshot(symbol, history) {
  const closes = history.points.map((point) => point.close).filter((value) => value != null);
  const volumes = history.points.map((point) => point.volume || 0);
  const latest = history.points[history.points.length - 1];
  const previous = history.points[history.points.length - 2] || latest;
  const latestClose = latest.close;
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);
  const avgVolume20 = average(volumes.slice(-20));
  const avgVolume50 = average(volumes.slice(-50));
  const fiveDayReference = closes[Math.max(0, closes.length - 6)] ?? latestClose;
  const twentyDayReference = closes[Math.max(0, closes.length - 21)] ?? latestClose;
  const sixtyDayReference = closes[Math.max(0, closes.length - 61)] ?? latestClose;

  return {
    symbol,
    shortName: history.shortName || symbol,
    latest,
    latestClose,
    priceChangePct: previous.close ? ((latestClose - previous.close) / previous.close) * 100 : null,
    return5dPct: fiveDayReference ? ((latestClose - fiveDayReference) / fiveDayReference) * 100 : null,
    return20dPct: twentyDayReference ? ((latestClose - twentyDayReference) / twentyDayReference) * 100 : null,
    return60dPct: sixtyDayReference ? ((latestClose - sixtyDayReference) / sixtyDayReference) * 100 : null,
    avgVolume20,
    avgVolume50,
    volumeRatio20: avgVolume20 ? latest.volume / avgVolume20 : null,
    volumeRatio50: avgVolume50 ? latest.volume / avgVolume50 : null,
    sma20,
    sma50,
    rsi14,
  };
}

function computeAtr(points, period = 14) {
  if (!points.length || points.length <= period) {
    return null;
  }

  const trueRanges = [];
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[index - 1];
    const intradayRange = Math.abs((current.high ?? current.close) - (current.low ?? current.close));
    const highToPrevClose = Math.abs((current.high ?? current.close) - previous.close);
    const lowToPrevClose = Math.abs((current.low ?? current.close) - previous.close);
    trueRanges.push(Math.max(intradayRange, highToPrevClose, lowToPrevClose));
  }

  if (trueRanges.length < period) {
    return null;
  }

  return average(trueRanges.slice(-period));
}

function evaluateTechnicalCore(points) {
  const closes = points.map((point) => point.close).filter((value) => value != null);
  const volumes = points.map((point) => point.volume || 0);
  const latest = points[points.length - 1];
  const previous = points[points.length - 2] || latest;
  const latestClose = latest.close;
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);
  const macd = computeMacd(closes);
  const avgVolume20 = average(volumes.slice(-20));
  const oneMonthAgo = closes[Math.max(0, closes.length - 22)] ?? latestClose;
  const monthReturn = oneMonthAgo ? ((latestClose - oneMonthAgo) / oneMonthAgo) * 100 : null;
  const recentCloses = closes.slice(-20);
  const recentHigh = recentCloses.length ? Math.max(...recentCloses) : latestClose;
  const recentLow = recentCloses.length ? Math.min(...recentCloses) : latestClose;
  const bollingerStd = standardDeviation(recentCloses);
  const bollingerUpper = sma20 != null && bollingerStd != null ? sma20 + 2 * bollingerStd : null;
  const bollingerLower = sma20 != null && bollingerStd != null ? sma20 - 2 * bollingerStd : null;
  const priceChange = previous.close ? ((latestClose - previous.close) / previous.close) * 100 : null;
  const scoreNotes = [];
  let score = 0;
  let bullishVotes = 0;
  let bearishVotes = 0;

  if (sma20 != null && latestClose > sma20) {
    score += 1;
    bullishVotes += 1;
    scoreNotes.push(`Price is above the 20-day average by ${formatPercent(((latestClose - sma20) / sma20) * 100)}.`);
  } else if (sma20 != null) {
    score -= 1;
    bearishVotes += 1;
    scoreNotes.push(`Price is below the 20-day average by ${formatPercent(((latestClose - sma20) / sma20) * 100)}.`);
  }

  if (sma50 != null && sma20 != null && sma20 > sma50) {
    score += 1;
    bullishVotes += 1;
    scoreNotes.push("Short-term trend is stronger than the 50-day trend.");
  } else if (sma50 != null && sma20 != null) {
    score -= 1;
    bearishVotes += 1;
    scoreNotes.push("Short-term trend is lagging the 50-day trend.");
  }

  if (sma200 != null && latestClose > sma200) {
    score += 1;
    bullishVotes += 1;
    scoreNotes.push("Price is trading above the long-term 200-day trend.");
  } else if (sma200 != null) {
    score -= 1;
    bearishVotes += 1;
    scoreNotes.push("Price is under the long-term 200-day trend.");
  }

  if (rsi14 != null && rsi14 >= 52 && rsi14 <= 68) {
    score += 1;
    bullishVotes += 1;
    scoreNotes.push(`RSI is constructive at ${rsi14.toFixed(1)}.`);
  } else if (rsi14 != null && rsi14 >= 75) {
    score -= 1;
    bearishVotes += 1;
    scoreNotes.push(`RSI is stretched at ${rsi14.toFixed(1)}.`);
  } else if (rsi14 != null && rsi14 <= 38) {
    score -= 1;
    bearishVotes += 1;
    scoreNotes.push(`RSI remains weak at ${rsi14.toFixed(1)}.`);
  }

  if (macd.histogram != null && macd.histogram > 0) {
    score += 1;
    bullishVotes += 1;
    scoreNotes.push("MACD momentum remains positive.");
  } else if (macd.histogram != null && macd.histogram < 0) {
    score -= 1;
    bearishVotes += 1;
    scoreNotes.push("MACD momentum is negative.");
  }

  if (latestClose >= recentHigh) {
    score += 1;
    bullishVotes += 1;
    scoreNotes.push("Price is pressing a 20-session breakout zone.");
  } else if (latestClose <= recentLow) {
    score -= 1;
    bearishVotes += 1;
    scoreNotes.push("Price is testing a 20-session breakdown zone.");
  }

  if (avgVolume20 != null && latest.volume != null && latest.volume > avgVolume20 * 1.35) {
    if ((priceChange || 0) >= 0) {
      score += 1;
      bullishVotes += 1;
      scoreNotes.push("Volume expanded on an up move, which supports demand.");
    } else {
      score -= 1;
      bearishVotes += 1;
      scoreNotes.push("Volume expanded on a down move, which points to distribution.");
    }
  }

  if (monthReturn != null && monthReturn >= 6) {
    score += 1;
    bullishVotes += 1;
    scoreNotes.push(`One-month return is strong at ${formatPercent(monthReturn)}.`);
  } else if (monthReturn != null && monthReturn <= -6) {
    score -= 1;
    bearishVotes += 1;
    scoreNotes.push(`One-month return is weak at ${formatPercent(monthReturn)}.`);
  }

  if (bollingerUpper != null && latestClose > bollingerUpper) {
    score -= 1;
    bearishVotes += 1;
    scoreNotes.push("Price is above the upper Bollinger band and may be overextended.");
  } else if (bollingerLower != null && latestClose < bollingerLower) {
    score += 1;
    bullishVotes += 1;
    scoreNotes.push("Price is below the lower Bollinger band and may be washout-level oversold.");
  }

  return {
    score,
    bullishVotes,
    bearishVotes,
    scoreNotes,
    latest,
    previous,
    latestClose,
    sma20,
    sma50,
    sma200,
    rsi14,
    macd,
    avgVolume20,
    monthReturn,
    recentHigh,
    recentLow,
    bollingerUpper,
    bollingerLower,
    priceChange,
    atr14: computeAtr(points, 14),
  };
}

function calibrateTechnicalSignal(points, targetCoreScore) {
  const samples = [];
  const minLookback = 120;
  const forward5d = 5;
  const forward20d = 20;

  for (let index = minLookback; index <= points.length - 1 - forward20d; index += 1) {
    const window = points.slice(0, index + 1);
    const state = evaluateTechnicalCore(window);
    if (Math.abs(state.score - targetCoreScore) > 2) {
      continue;
    }

    const currentClose = points[index].close;
    const close5d = points[index + forward5d]?.close;
    const close20d = points[index + forward20d]?.close;
    if (currentClose == null || close5d == null || close20d == null) {
      continue;
    }

    samples.push({
      return5d: ((close5d - currentClose) / currentClose) * 100,
      return20d: ((close20d - currentClose) / currentClose) * 100,
    });
  }

  if (samples.length < 5) {
    return null;
  }

  const positive5d = samples.filter((sample) => sample.return5d > 0).length;
  const positive20d = samples.filter((sample) => sample.return20d > 0).length;
  return {
    sampleSize: samples.length,
    probPositive5d: positive5d / samples.length,
    probPositive20d: positive20d / samples.length,
    avgForward5d: average(samples.map((sample) => sample.return5d)),
    avgForward20d: average(samples.map((sample) => sample.return20d)),
  };
}

function getBenchmarkSymbolForStock(symbol) {
  return SECTOR_BENCHMARKS[symbol] || BENCHMARKS.growth;
}

function calculateRelativeStrength(assetReturn, benchmarkReturn) {
  if (assetReturn == null || benchmarkReturn == null) {
    return null;
  }

  return assetReturn - benchmarkReturn;
}

function classifyMarketRegime(benchmarks) {
  const broad = benchmarks[BENCHMARKS.broad];
  const growth = benchmarks[BENCHMARKS.growth];
  if (!broad || !growth) {
    return "mixed";
  }

  let bullishVotes = 0;
  let bearishVotes = 0;

  [broad, growth].forEach((snapshot) => {
    if (snapshot.sma20 != null && snapshot.latestClose > snapshot.sma20) {
      bullishVotes += 1;
    } else {
      bearishVotes += 1;
    }

    if (snapshot.sma50 != null && snapshot.latestClose > snapshot.sma50) {
      bullishVotes += 1;
    } else {
      bearishVotes += 1;
    }

    if ((snapshot.return20dPct || 0) >= 0) {
      bullishVotes += 1;
    } else {
      bearishVotes += 1;
    }
  });

  if (bullishVotes - bearishVotes >= 2) {
    return "risk_on";
  }

  if (bearishVotes - bullishVotes >= 2) {
    return "risk_off";
  }

  return "mixed";
}

async function fetchBenchmarkContext(symbols, range = "1y") {
  const benchmarkSymbols = new Set([BENCHMARKS.broad, BENCHMARKS.growth]);
  symbols.forEach((symbol) => benchmarkSymbols.add(getBenchmarkSymbolForStock(symbol)));

  const settled = await Promise.allSettled(
    [...benchmarkSymbols].map(async (symbol) => {
      const history = await fetchHistory(symbol, range);
      return [symbol, buildFlowSnapshot(symbol, history)];
    })
  );

  const entries = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const benchmarks = Object.fromEntries(entries);
  return {
    benchmarks,
    regime: classifyMarketRegime(benchmarks),
  };
}

function buildTechnicalRecommendation(symbol, history, marketContext = null, options = {}) {
  const snapshot = buildFlowSnapshot(symbol, history);
  const core = evaluateTechnicalCore(history.points);
  const latest = core.latest;
  const latestClose = core.latestClose;
  const sma20 = core.sma20;
  const sma50 = core.sma50;
  const sma200 = core.sma200;
  const rsi14 = core.rsi14;
  const macd = core.macd;
  const avgVolume20 = core.avgVolume20;
  const monthReturn = core.monthReturn;
  const recentHigh = core.recentHigh;
  const recentLow = core.recentLow;
  const bollingerUpper = core.bollingerUpper;
  const bollingerLower = core.bollingerLower;
  const priceChange = core.priceChange;
  const benchmarkSymbol = getBenchmarkSymbolForStock(symbol);
  const broadBenchmark = marketContext?.benchmarks?.[BENCHMARKS.broad] || null;
  const sectorBenchmark = marketContext?.benchmarks?.[benchmarkSymbol] || null;
  const relativeStrengthBroad20 = calculateRelativeStrength(snapshot.return20dPct, broadBenchmark?.return20dPct);
  const relativeStrengthSector20 = calculateRelativeStrength(snapshot.return20dPct, sectorBenchmark?.return20dPct);
  const relativeStrengthBroad60 = calculateRelativeStrength(snapshot.return60dPct, broadBenchmark?.return60dPct);
  const regime = marketContext?.regime || "mixed";
  const scoreNotes = [...core.scoreNotes];
  let score = core.score;
  let bullishVotes = core.bullishVotes;
  let bearishVotes = core.bearishVotes;

  if (relativeStrengthBroad20 != null && relativeStrengthBroad20 >= 3) {
    score += 1;
    bullishVotes += 1;
    scoreNotes.push(`Relative strength versus ${BENCHMARKS.broad} is positive by ${formatPercent(relativeStrengthBroad20)} over 20 sessions.`);
  } else if (relativeStrengthBroad20 != null && relativeStrengthBroad20 <= -3) {
    score -= 1;
    bearishVotes += 1;
    scoreNotes.push(`Relative strength versus ${BENCHMARKS.broad} is weak by ${formatPercent(relativeStrengthBroad20)} over 20 sessions.`);
  }

  if (relativeStrengthSector20 != null && relativeStrengthSector20 >= 2) {
    score += 1;
    bullishVotes += 1;
    scoreNotes.push(`The stock is outperforming ${benchmarkSymbol} by ${formatPercent(relativeStrengthSector20)} over 20 sessions.`);
  } else if (relativeStrengthSector20 != null && relativeStrengthSector20 <= -2) {
    score -= 1;
    bearishVotes += 1;
    scoreNotes.push(`The stock is lagging ${benchmarkSymbol} by ${formatPercent(relativeStrengthSector20)} over 20 sessions.`);
  }

  if (regime === "risk_on") {
    scoreNotes.push("Market regime is risk-on.");
    if (score > 0) {
      score += 1;
    } else if (score < 0) {
      score -= 1;
    }
  } else if (regime === "risk_off") {
    scoreNotes.push("Market regime is risk-off.");
    if (score > 0) {
      score -= 1;
    } else if (score < 0) {
      score += 1;
    }
  } else {
    scoreNotes.push("Market regime is mixed.");
  }

  let recommendation = "Hold";
  if (score >= 6) {
    recommendation = "Strong Buy";
  } else if (score >= 3) {
    recommendation = "Buy";
  } else if (score <= -6) {
    recommendation = "Strong Sell";
  } else if (score <= -3) {
    recommendation = "Sell";
  }

  const mixedSignal = bullishVotes >= 3 && bearishVotes >= 3 && Math.abs(bullishVotes - bearishVotes) <= 1;
  const weakEdge = Math.abs(score) <= 2;
  const longBlockedByRegime =
    recommendation.includes("Buy") &&
    regime === "risk_off" &&
    (relativeStrengthBroad20 == null || relativeStrengthBroad20 < 5);
  const shortBlockedByRegime =
    recommendation.includes("Sell") &&
    regime === "risk_on" &&
    (relativeStrengthBroad20 == null || relativeStrengthBroad20 > -5);

  if (mixedSignal || weakEdge) {
    recommendation = "No Trade";
  } else if (longBlockedByRegime || shortBlockedByRegime) {
    recommendation = "Watch";
  }

  const calibration = options.skipCalibration ? null : calibrateTechnicalSignal(history.points, core.score);
  if (calibration) {
    scoreNotes.push(
      `Historical matches: ${calibration.sampleSize}, 5D hit rate ${(calibration.probPositive5d * 100).toFixed(0)}%, avg 20D return ${formatPercent(calibration.avgForward20d)}.`
    );

    if (
      recommendation.includes("Buy") &&
      (calibration.probPositive20d < 0.55 || (calibration.avgForward20d != null && calibration.avgForward20d < 1))
    ) {
      recommendation = "Watch";
    } else if (
      recommendation.includes("Sell") &&
      (calibration.probPositive20d > 0.45 || (calibration.avgForward20d != null && calibration.avgForward20d > -1))
    ) {
      recommendation = "Watch";
    }
  }

  return {
    symbol,
    shortName: history.shortName || symbol,
    recommendation,
    score,
    confidence:
      recommendation === "No Trade"
        ? "Low"
        : Math.abs(score) >= 6 && !mixedSignal
          ? "High"
          : Math.abs(score) >= 4
            ? "Medium"
            : "Low",
    summary: scoreNotes.slice(0, 5),
    metrics: {
      price: latestClose,
      oneDayChangePct: priceChange,
      monthReturnPct: monthReturn,
      rsi14,
      sma20,
      sma50,
      sma200,
      avgVolume20,
      latestVolume: latest.volume ?? null,
      macdHistogram: macd.histogram,
      relativeStrengthBroad20,
      relativeStrengthSector20,
      relativeStrengthBroad60,
      marketRegime: regime,
      benchmarkSymbol,
      bullishVotes,
      bearishVotes,
      atr14: core.atr14,
      stopDistancePct: core.atr14 != null && latestClose ? (core.atr14 * 1.5 * 100) / latestClose : null,
      targetDistancePct: core.atr14 != null && latestClose ? (core.atr14 * 3 * 100) / latestClose : null,
      hitRate5d: calibration?.probPositive5d ?? null,
      hitRate20d: calibration?.probPositive20d ?? null,
      expectedReturn5d: calibration?.avgForward5d ?? null,
      expectedReturn20d: calibration?.avgForward20d ?? null,
      calibrationSamples: calibration?.sampleSize ?? 0,
    },
  };
}

function getCloseFromSessionsAgo(closes, sessionsAgo, fallbackValue = null) {
  return closes[Math.max(0, closes.length - 1 - sessionsAgo)] ?? fallbackValue;
}

function averageDollarVolume(avgVolume, price) {
  if (avgVolume == null || price == null) {
    return null;
  }

  return avgVolume * price;
}

function classifyActionPriority(score, bias, setupType, flags, regime) {
  const actionableSetup = !["Range Watch", "Oversold Bounce Watch", "Failed Bounce Watch"].includes(setupType);
  const blockedLong = bias === "Long" && regime === "risk_off";
  const blockedShort = bias === "Short" && regime === "risk_on";

  if (flags.lowLiquidity || !bias || bias === "Neutral") {
    return "Avoid";
  }

  if (flags.tooExtended || blockedLong || blockedShort) {
    return Math.abs(score) >= 5 ? "Watch Only" : "Avoid";
  }

  if (Math.abs(score) >= 8 && actionableSetup) {
    return "Action Now";
  }

  if (Math.abs(score) >= 5 && actionableSetup) {
    return "Near Trigger";
  }

  if (Math.abs(score) >= 3) {
    return "Watch Only";
  }

  return "Avoid";
}

function buildShortTermState(points) {
  const closes = points.map((point) => point.close).filter((value) => value != null);
  const volumes = points.map((point) => point.volume || 0);
  const latest = points[points.length - 1];
  const previous = points[points.length - 2] || latest;
  const latestClose = latest?.close ?? null;
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const ema8 = ema(closes, 8);
  const rsi14 = rsi(closes, 14);
  const avgVolume20 = average(volumes.slice(-20));
  const atr14 = computeAtr(points, 14);
  const recentHigh20 = closes.slice(-20).length ? Math.max(...closes.slice(-20)) : latestClose;
  const recentLow20 = closes.slice(-20).length ? Math.min(...closes.slice(-20)) : latestClose;
  const close3d = getCloseFromSessionsAgo(closes, 3, latestClose);
  const close5d = getCloseFromSessionsAgo(closes, 5, latestClose);
  const close20d = getCloseFromSessionsAgo(closes, 20, latestClose);
  const oneDayChangePct = previous?.close ? ((latestClose - previous.close) / previous.close) * 100 : null;
  const return3dPct = close3d ? ((latestClose - close3d) / close3d) * 100 : null;
  const return5dPct = close5d ? ((latestClose - close5d) / close5d) * 100 : null;
  const return20dPct = close20d ? ((latestClose - close20d) / close20d) * 100 : null;
  const volumeRatio20 = avgVolume20 ? latest.volume / avgVolume20 : null;
  const distFromBreakoutPct = recentHigh20 ? ((recentHigh20 - latestClose) / latestClose) * 100 : null;
  const distFromBreakdownPct = recentLow20 ? ((latestClose - recentLow20) / latestClose) * 100 : null;
  const distFromSma20Pct = sma20 ? ((latestClose - sma20) / sma20) * 100 : null;
  const distFromEma8Pct = ema8 ? ((latestClose - ema8) / ema8) * 100 : null;
  const avgDollarVolume20 = averageDollarVolume(avgVolume20, latestClose);
  const notes = [];
  let longScore = 0;
  let shortScore = 0;

  if (sma20 != null && latestClose > sma20) {
    longScore += 2;
    notes.push("Price is above the 20-day trend.");
  } else if (sma20 != null) {
    shortScore += 2;
    notes.push("Price is below the 20-day trend.");
  }

  if (sma50 != null && latestClose > sma50) {
    longScore += 1;
  } else if (sma50 != null) {
    shortScore += 1;
  }

  if (ema8 != null && sma20 != null && ema8 > sma20) {
    longScore += 1;
  } else if (ema8 != null && sma20 != null && ema8 < sma20) {
    shortScore += 1;
  }

  if (return3dPct != null && return3dPct >= 2) {
    longScore += 1;
  } else if (return3dPct != null && return3dPct <= -2) {
    shortScore += 1;
  }

  if (return5dPct != null && return5dPct >= 4) {
    longScore += 2;
    notes.push(`Five-day trend is strong at ${formatPercent(return5dPct)}.`);
  } else if (return5dPct != null && return5dPct <= -4) {
    shortScore += 2;
    notes.push(`Five-day trend is weak at ${formatPercent(return5dPct)}.`);
  }

  if (volumeRatio20 != null && volumeRatio20 >= 1.2 && (oneDayChangePct || 0) > 0) {
    longScore += volumeRatio20 >= 1.8 ? 2 : 1;
    notes.push(`Relative volume is elevated at ${volumeRatio20.toFixed(1)}x on an up session.`);
  } else if (volumeRatio20 != null && volumeRatio20 >= 1.2 && (oneDayChangePct || 0) < 0) {
    shortScore += volumeRatio20 >= 1.8 ? 2 : 1;
    notes.push(`Relative volume is elevated at ${volumeRatio20.toFixed(1)}x on a down session.`);
  }

  if (rsi14 != null && rsi14 >= 54 && rsi14 <= 70) {
    longScore += 1;
  } else if (rsi14 != null && rsi14 <= 46 && rsi14 >= 30) {
    shortScore += 1;
  }

  const longBreakoutReady = distFromBreakoutPct != null && distFromBreakoutPct <= 1.2 && latestClose >= (recentHigh20 || 0) * 0.988;
  const shortBreakdownReady =
    distFromBreakdownPct != null && distFromBreakdownPct <= 1.2 && latestClose <= (recentLow20 || 0) * 1.012;
  const longPullbackReady =
    sma20 != null &&
    sma50 != null &&
    latestClose > sma50 &&
    distFromSma20Pct != null &&
    distFromSma20Pct >= -2 &&
    distFromSma20Pct <= 1.5 &&
    (return20dPct || 0) > 0;
  const shortBounceFailReady =
    sma20 != null &&
    sma50 != null &&
    latestClose < sma50 &&
    distFromSma20Pct != null &&
    distFromSma20Pct <= 2 &&
    distFromSma20Pct >= -1.5 &&
    (return20dPct || 0) < 0;
  const longMomentumReady =
    (return5dPct || 0) >= 5 &&
    (volumeRatio20 || 0) >= 1.1 &&
    sma20 != null &&
    latestClose > sma20;
  const shortMomentumReady =
    (return5dPct || 0) <= -5 &&
    (volumeRatio20 || 0) >= 1.1 &&
    sma20 != null &&
    latestClose < sma20;

  if (longBreakoutReady) {
    longScore += 2;
    notes.push("Price is pressing a short-term breakout trigger.");
  }

  if (shortBreakdownReady) {
    shortScore += 2;
    notes.push("Price is pressing a short-term breakdown trigger.");
  }

  if (longPullbackReady) {
    longScore += 2;
    notes.push("Price is sitting near the 20-day trend inside a broader uptrend.");
  }

  if (shortBounceFailReady) {
    shortScore += 2;
    notes.push("Price is failing near the 20-day trend inside a broader downtrend.");
  }

  const lowLiquidity = avgDollarVolume20 != null && avgDollarVolume20 < 25_000_000;
  const tooExtendedLong =
    biasFromScores(longScore, shortScore) === "Long" &&
    ((distFromEma8Pct != null && distFromEma8Pct >= 6) || (rsi14 != null && rsi14 >= 76));
  const tooExtendedShort =
    biasFromScores(longScore, shortScore) === "Short" &&
    ((distFromEma8Pct != null && distFromEma8Pct <= -6) || (rsi14 != null && rsi14 <= 26));

  let setupType = "Range Watch";
  if (longBreakoutReady) {
    setupType = "Breakout";
  } else if (longPullbackReady) {
    setupType = "Pullback";
  } else if (longMomentumReady) {
    setupType = "Momentum Continuation";
  } else if (shortBreakdownReady) {
    setupType = "Breakdown";
  } else if (shortBounceFailReady) {
    setupType = "Failed Bounce";
  } else if (shortMomentumReady) {
    setupType = "Momentum Fade";
  } else if ((rsi14 || 100) <= 32 && latestClose < (sma20 || latestClose)) {
    setupType = "Oversold Bounce Watch";
  }

  return {
    latest,
    latestClose,
    previous,
    sma20,
    sma50,
    ema8,
    rsi14,
    avgVolume20,
    avgDollarVolume20,
    atr14,
    recentHigh20,
    recentLow20,
    oneDayChangePct,
    return3dPct,
    return5dPct,
    return20dPct,
    volumeRatio20,
    distFromBreakoutPct,
    distFromBreakdownPct,
    distFromSma20Pct,
    distFromEma8Pct,
    longScore,
    shortScore,
    setupType,
    notes,
    flags: {
      lowLiquidity,
      tooExtendedLong,
      tooExtendedShort,
    },
  };
}

function biasFromScores(longScore, shortScore) {
  if (longScore - shortScore >= 2) {
    return "Long";
  }

  if (shortScore - longScore >= 2) {
    return "Short";
  }

  return "Neutral";
}

function calibrateShortTermSignal(points, targetSetupType, targetBias, targetScore) {
  if (!targetBias || targetBias === "Neutral" || !targetSetupType || targetSetupType === "Range Watch") {
    return null;
  }

  const samples = [];
  const minLookback = 90;
  const forward3d = 3;
  const forward5d = 5;

  for (let index = minLookback; index <= points.length - 1 - forward5d; index += 1) {
    const window = points.slice(0, index + 1);
    const state = buildShortTermState(window);
    const setupScore = state.longScore - state.shortScore;
    const stateBias = biasFromScores(state.longScore, state.shortScore);
    if (stateBias !== targetBias) {
      continue;
    }
    if (state.setupType !== targetSetupType) {
      continue;
    }
    if (Math.abs(setupScore - targetScore) > 3) {
      continue;
    }

    const currentClose = points[index]?.close;
    const close3d = points[index + forward3d]?.close;
    const close5d = points[index + forward5d]?.close;
    if (currentClose == null || close3d == null || close5d == null) {
      continue;
    }

    const rawReturn3d = ((close3d - currentClose) / currentClose) * 100;
    const rawReturn5d = ((close5d - currentClose) / currentClose) * 100;
    const directionSign = targetBias === "Long" ? 1 : -1;
    samples.push({
      strategyReturn3d: rawReturn3d * directionSign,
      strategyReturn5d: rawReturn5d * directionSign,
    });
  }

  if (samples.length < 4) {
    return null;
  }

  const positive3d = samples.filter((sample) => sample.strategyReturn3d > 0).length;
  const positive5d = samples.filter((sample) => sample.strategyReturn5d > 0).length;
  return {
    sampleSize: samples.length,
    hitRate3d: positive3d / samples.length,
    hitRate5d: positive5d / samples.length,
    expectedReturn3d: average(samples.map((sample) => sample.strategyReturn3d)),
    expectedReturn5d: average(samples.map((sample) => sample.strategyReturn5d)),
  };
}

function buildShortTermRecommendation(symbol, history, marketContext = null, options = {}) {
  const snapshot = buildFlowSnapshot(symbol, history);
  const state = buildShortTermState(history.points);
  const benchmarkSymbol = getBenchmarkSymbolForStock(symbol);
  const broadBenchmark = marketContext?.benchmarks?.[BENCHMARKS.broad] || null;
  const sectorBenchmark = marketContext?.benchmarks?.[benchmarkSymbol] || null;
  const relativeStrengthBroad5 = calculateRelativeStrength(snapshot.return5dPct, broadBenchmark?.return5dPct);
  const relativeStrengthBroad20 = calculateRelativeStrength(snapshot.return20dPct, broadBenchmark?.return20dPct);
  const relativeStrengthSector20 = calculateRelativeStrength(snapshot.return20dPct, sectorBenchmark?.return20dPct);
  const regime = marketContext?.regime || "mixed";
  const summary = [...state.notes];
  let netScore = state.longScore - state.shortScore;
  let bias = biasFromScores(state.longScore, state.shortScore);

  if (relativeStrengthBroad5 != null && relativeStrengthBroad5 >= 2) {
    netScore += 1;
    if (bias !== "Short") {
      summary.push(`Five-day relative strength versus ${BENCHMARKS.broad} is positive by ${formatPercent(relativeStrengthBroad5)}.`);
    }
  } else if (relativeStrengthBroad5 != null && relativeStrengthBroad5 <= -2) {
    netScore -= 1;
    if (bias !== "Long") {
      summary.push(`Five-day relative strength versus ${BENCHMARKS.broad} is weak by ${formatPercent(relativeStrengthBroad5)}.`);
    }
  }

  if (relativeStrengthSector20 != null && relativeStrengthSector20 >= 2) {
    netScore += 1;
  } else if (relativeStrengthSector20 != null && relativeStrengthSector20 <= -2) {
    netScore -= 1;
  }

  if (regime === "risk_on" && netScore > 0) {
    netScore += 1;
    summary.push("Market regime is supportive for long setups.");
  } else if (regime === "risk_off" && netScore < 0) {
    netScore -= 1;
    summary.push("Market regime is supportive for short setups.");
  } else if (regime === "risk_off" && netScore > 0) {
    netScore -= 1;
    summary.push("Market regime is hostile for aggressive long setups.");
  } else if (regime === "risk_on" && netScore < 0) {
    netScore += 1;
    summary.push("Market regime is hostile for aggressive short setups.");
  } else {
    summary.push("Market regime is mixed.");
  }

  bias = netScore >= 2 ? "Long" : netScore <= -2 ? "Short" : "Neutral";
  const calibration =
    options.skipCalibration
      ? null
      : calibrateShortTermSignal(history.points, state.setupType, bias, netScore);

  const tooExtended = bias === "Long" ? state.flags.tooExtendedLong : bias === "Short" ? state.flags.tooExtendedShort : false;
  const action = classifyActionPriority(
    netScore,
    bias,
    state.setupType,
    { lowLiquidity: state.flags.lowLiquidity, tooExtended },
    regime
  );
  const triggerPrice =
    state.setupType === "Breakout"
      ? state.recentHigh20
      : state.setupType === "Breakdown"
        ? state.recentLow20
        : state.sma20;
  const stopDistanceMultiplier = bias === "Short" ? 1.2 : 1.2;
  const stopPrice =
    state.atr14 == null || state.latestClose == null
      ? null
      : bias === "Short"
        ? state.latestClose + state.atr14 * stopDistanceMultiplier
        : state.latestClose - state.atr14 * stopDistanceMultiplier;
  const targetPrice =
    state.atr14 == null || state.latestClose == null
      ? null
      : bias === "Short"
        ? state.latestClose - state.atr14 * 2.2
        : state.latestClose + state.atr14 * 2.2;

  if (tooExtended) {
    summary.push("Setup is extended from the 8-day trend and should not be chased aggressively.");
  }

  if (state.flags.lowLiquidity) {
    summary.push("Dollar volume is below the preferred short-term liquidity threshold.");
  }

  if (calibration) {
    summary.push(
      `Similar ${state.setupType.toLowerCase()} setups: ${calibration.sampleSize}, 3D hit rate ${(calibration.hitRate3d * 100).toFixed(0)}%, avg 5D return ${formatPercent(calibration.expectedReturn5d)}.`
    );
  }

  return {
    symbol,
    shortName: history.shortName || symbol,
    setupType: state.setupType,
    bias,
    recommendation: action,
    score: netScore,
    confidence:
      action === "Action Now"
        ? "High"
        : action === "Near Trigger"
          ? "Medium"
          : action === "Watch Only"
            ? "Low"
            : "Low",
    summary: summary.slice(0, 5),
    metrics: {
      price: state.latestClose,
      oneDayChangePct: state.oneDayChangePct,
      return3dPct: state.return3dPct,
      return5dPct: state.return5dPct,
      return20dPct: state.return20dPct,
      rsi14: state.rsi14,
      avgVolume20: state.avgVolume20,
      latestVolume: state.latest.volume ?? null,
      avgDollarVolume20: state.avgDollarVolume20,
      volumeRatio20: state.volumeRatio20,
      sma20: state.sma20,
      sma50: state.sma50,
      ema8: state.ema8,
      atr14: state.atr14,
      relativeStrengthBroad5,
      relativeStrengthBroad20,
      relativeStrengthSector20,
      marketRegime: regime,
      benchmarkSymbol,
      distFromBreakoutPct: state.distFromBreakoutPct,
      distFromSma20Pct: state.distFromSma20Pct,
      triggerPrice,
      stopPrice,
      targetPrice,
      stopDistancePct: stopPrice != null && state.latestClose ? (Math.abs(state.latestClose - stopPrice) * 100) / state.latestClose : null,
      targetDistancePct: targetPrice != null && state.latestClose ? (Math.abs(targetPrice - state.latestClose) * 100) / state.latestClose : null,
      hitRate3d: calibration?.hitRate3d ?? null,
      hitRate5d: calibration?.hitRate5d ?? null,
      expectedReturn3d: calibration?.expectedReturn3d ?? null,
      expectedReturn5d: calibration?.expectedReturn5d ?? null,
      calibrationSamples: calibration?.sampleSize ?? 0,
      tooExtended,
      lowLiquidity: state.flags.lowLiquidity,
    },
  };
}

function getPointsUpToDate(points, targetDate) {
  return points.filter((point) => point.date <= targetDate);
}

function getDirectionFromRecommendation(recommendation) {
  if (recommendation.includes("Buy")) {
    return "long";
  }

  if (recommendation.includes("Sell")) {
    return "short";
  }

  return "flat";
}

function getDirectionSign(direction) {
  if (direction === "long") {
    return 1;
  }

  if (direction === "short") {
    return -1;
  }

  return 0;
}

function getForwardReturnFromHistory(history, entryDate, forwardDays) {
  const entryIndex = history.points.findIndex((point) => point.date === entryDate);
  if (entryIndex < 0) {
    return null;
  }

  const currentClose = history.points[entryIndex]?.close;
  const forwardClose = history.points[entryIndex + forwardDays]?.close;
  if (currentClose == null || forwardClose == null) {
    return null;
  }

  return ((forwardClose - currentClose) / currentClose) * 100;
}

function buildMarketContextForDate(symbol, benchmarkHistories, targetDate) {
  const benchmarkSymbols = [BENCHMARKS.broad, BENCHMARKS.growth, getBenchmarkSymbolForStock(symbol)];
  const entries = benchmarkSymbols
    .map((benchmarkSymbol) => {
      const history = benchmarkHistories[benchmarkSymbol];
      if (!history) {
        return null;
      }

      const slicedPoints = getPointsUpToDate(history.points, targetDate);
      if (slicedPoints.length < 60) {
        return null;
      }

      return [benchmarkSymbol, buildFlowSnapshot(benchmarkSymbol, { ...history, points: slicedPoints })];
    })
    .filter(Boolean);

  const benchmarks = Object.fromEntries(entries);
  return {
    benchmarks,
    regime: classifyMarketRegime(benchmarks),
  };
}

function aggregateBacktestRecords(records) {
  if (!records.length) {
    return null;
  }

  const positive5d = records.filter((record) => (record.strategyNet5d ?? 0) > 0).length;
  const positive20d = records.filter((record) => (record.strategyNet20d ?? 0) > 0).length;
  const positiveAlpha20d = records.filter((record) => (record.alphaNet20d ?? 0) > 0).length;
  return {
    totalSignals: records.length,
    hitRate5d: positive5d / records.length,
    hitRate20d: positive20d / records.length,
    alphaHitRate20d: positiveAlpha20d / records.length,
    avgReturn5d: average(records.map((record) => record.assetReturn5d)),
    avgReturn20d: average(records.map((record) => record.assetReturn20d)),
    avgBenchmark20d: average(records.map((record) => record.benchmarkReturn20d)),
    avgAlpha20d: average(records.map((record) => record.alphaGross20d)),
    avgNet20d: average(records.map((record) => record.strategyNet20d)),
    avgAlphaNet20d: average(records.map((record) => record.alphaNet20d)),
  };
}

function backtestTechnicalHistory(symbol, history, benchmarkHistories) {
  const recommendationBuckets = {
    "Strong Buy": [],
    Buy: [],
    Watch: [],
    "No Trade": [],
    Sell: [],
    "Strong Sell": [],
  };
  const overall = [];
  const directionalBuckets = {
    long: [],
    short: [],
    flat: [],
  };
  const minLookback = 220;
  const forward5d = 5;
  const forward20d = 20;
  let previousDirection = "flat";

  for (let index = minLookback; index <= history.points.length - 1 - forward20d; index += 1) {
    const slicedPoints = history.points.slice(0, index + 1);
    const currentPoint = history.points[index];
    const assetReturn5d = getForwardReturnFromHistory(history, currentPoint.date, forward5d);
    const assetReturn20d = getForwardReturnFromHistory(history, currentPoint.date, forward20d);
    if (currentPoint?.close == null || assetReturn5d == null || assetReturn20d == null) {
      continue;
    }

    const context = buildMarketContextForDate(symbol, benchmarkHistories, currentPoint.date);
    const recommendation = buildTechnicalRecommendation(
      symbol,
      { ...history, points: slicedPoints },
      context,
      { skipCalibration: true }
    );
    const direction = getDirectionFromRecommendation(recommendation.recommendation);
    const directionSign = getDirectionSign(direction);
    const benchmarkSymbol = recommendation.metrics.benchmarkSymbol || getBenchmarkSymbolForStock(symbol);
    const benchmarkHistory = benchmarkHistories[benchmarkSymbol];
    const benchmarkReturn5d = benchmarkHistory
      ? getForwardReturnFromHistory(benchmarkHistory, currentPoint.date, forward5d)
      : null;
    const benchmarkReturn20d = benchmarkHistory
      ? getForwardReturnFromHistory(benchmarkHistory, currentPoint.date, forward20d)
      : null;
    const transactionCostPct =
      direction === "flat"
        ? 0
        : previousDirection === "flat" || previousDirection !== direction
          ? BACKTEST_TRANSACTION_COST_PCT
          : BACKTEST_TRANSACTION_COST_PCT / 2;
    const strategyGross5d = directionSign * assetReturn5d;
    const strategyGross20d = directionSign * assetReturn20d;
    const alphaGross5d =
      benchmarkReturn5d == null ? null : directionSign * (assetReturn5d - benchmarkReturn5d);
    const alphaGross20d =
      benchmarkReturn20d == null ? null : directionSign * (assetReturn20d - benchmarkReturn20d);

    const record = {
      asOfDate: currentPoint.date,
      recommendation: recommendation.recommendation,
      direction,
      score: recommendation.score,
      regime: recommendation.metrics.marketRegime,
      assetReturn5d,
      assetReturn20d,
      benchmarkSymbol,
      benchmarkReturn5d,
      benchmarkReturn20d,
      strategyGross5d,
      strategyGross20d,
      strategyNet5d: strategyGross5d - transactionCostPct,
      strategyNet20d: strategyGross20d - transactionCostPct,
      alphaGross5d,
      alphaGross20d,
      alphaNet5d: alphaGross5d == null ? null : alphaGross5d - transactionCostPct,
      alphaNet20d: alphaGross20d == null ? null : alphaGross20d - transactionCostPct,
      transactionCostPct,
    };

    overall.push(record);
    if (recommendationBuckets[record.recommendation]) {
      recommendationBuckets[record.recommendation].push(record);
    }
    directionalBuckets[direction].push(record);
    previousDirection = direction;
  }

  const bucketSummary = Object.fromEntries(
    Object.entries(recommendationBuckets)
      .map(([key, records]) => [key, aggregateBacktestRecords(records)])
      .filter(([, value]) => value)
  );
  const directionalSummary = Object.fromEntries(
    Object.entries(directionalBuckets)
      .map(([key, records]) => [key, aggregateBacktestRecords(records)])
      .filter(([, value]) => value)
  );

  return {
    symbol,
    shortName: history.shortName || symbol,
    totalWindows: overall.length,
    overall: aggregateBacktestRecords(overall),
    byRecommendation: bucketSummary,
    byDirection: directionalSummary,
    records: overall,
  };
}

function buildMarketFlowRecommendation(symbol, history, marketContext = null) {
  const snapshot = buildFlowSnapshot(symbol, history);
  const summary = [];
  let score = 0;
  const regime = marketContext?.regime || "mixed";
  const broadBenchmark = marketContext?.benchmarks?.[BENCHMARKS.broad] || null;
  const benchmarkSymbol = getBenchmarkSymbolForStock(symbol);
  const sectorBenchmark = marketContext?.benchmarks?.[benchmarkSymbol] || null;
  const relativeStrengthBroad20 = calculateRelativeStrength(snapshot.return20dPct, broadBenchmark?.return20dPct);
  const relativeStrengthSector20 = calculateRelativeStrength(snapshot.return20dPct, sectorBenchmark?.return20dPct);

  if (snapshot.volumeRatio20 != null && snapshot.volumeRatio20 >= 1.8) {
    if ((snapshot.return5dPct || 0) >= 0) {
      score += 3;
      summary.push(`Volume is ${snapshot.volumeRatio20.toFixed(1)}x the 20-day average while price is advancing.`);
    } else {
      score -= 3;
      summary.push(`Volume is ${snapshot.volumeRatio20.toFixed(1)}x the 20-day average while price is falling.`);
    }
  } else if (snapshot.volumeRatio20 != null && snapshot.volumeRatio20 >= 1.25) {
    score += (snapshot.return5dPct || 0) >= 0 ? 1 : -1;
    summary.push(`Volume is elevated at ${snapshot.volumeRatio20.toFixed(1)}x the 20-day baseline.`);
  }

  if (snapshot.return5dPct != null && snapshot.return5dPct >= 5) {
    score += 2;
    summary.push(`Five-day move is strong at ${formatPercent(snapshot.return5dPct)}.`);
  } else if (snapshot.return5dPct != null && snapshot.return5dPct <= -5) {
    score -= 2;
    summary.push(`Five-day move is weak at ${formatPercent(snapshot.return5dPct)}.`);
  }

  if (snapshot.return20dPct != null && snapshot.return20dPct >= 10) {
    score += 2;
    summary.push(`Twenty-day momentum remains positive at ${formatPercent(snapshot.return20dPct)}.`);
  } else if (snapshot.return20dPct != null && snapshot.return20dPct <= -10) {
    score -= 2;
    summary.push(`Twenty-day momentum remains negative at ${formatPercent(snapshot.return20dPct)}.`);
  }

  if (snapshot.sma20 != null && snapshot.latestClose > snapshot.sma20) {
    score += 1;
    summary.push("Price is holding above the 20-day trend.");
  } else if (snapshot.sma20 != null) {
    score -= 1;
    summary.push("Price is below the 20-day trend.");
  }

  if (snapshot.sma50 != null && snapshot.latestClose > snapshot.sma50) {
    score += 1;
    summary.push("Price is also above the 50-day trend.");
  } else if (snapshot.sma50 != null) {
    score -= 1;
    summary.push("Price is below the 50-day trend.");
  }

  if (snapshot.rsi14 != null && snapshot.rsi14 >= 55 && snapshot.rsi14 <= 72) {
    score += 1;
    summary.push(`RSI supports the move at ${snapshot.rsi14.toFixed(1)}.`);
  } else if (snapshot.rsi14 != null && snapshot.rsi14 <= 40) {
    score -= 1;
    summary.push(`RSI remains weak at ${snapshot.rsi14.toFixed(1)}.`);
  }

  if (relativeStrengthBroad20 != null && relativeStrengthBroad20 >= 3) {
    score += 1;
    summary.push(`Relative strength versus ${BENCHMARKS.broad} is positive by ${formatPercent(relativeStrengthBroad20)}.`);
  } else if (relativeStrengthBroad20 != null && relativeStrengthBroad20 <= -3) {
    score -= 1;
    summary.push(`Relative strength versus ${BENCHMARKS.broad} is weak by ${formatPercent(relativeStrengthBroad20)}.`);
  }

  if (relativeStrengthSector20 != null && relativeStrengthSector20 >= 2) {
    score += 1;
  } else if (relativeStrengthSector20 != null && relativeStrengthSector20 <= -2) {
    score -= 1;
  }

  let recommendation = "Balanced Flow";
  if (score >= 6) {
    recommendation = "Heavy Accumulation";
  } else if (score >= 3) {
    recommendation = "Buy Pressure";
  } else if (score <= -6) {
    recommendation = "Heavy Distribution";
  } else if (score <= -3) {
    recommendation = "Sell Pressure";
  }

  if (Math.abs(score) <= 2) {
    recommendation = "Balanced Flow";
  } else if (recommendation.includes("Buy") && regime === "risk_off" && (relativeStrengthBroad20 || 0) < 5) {
    recommendation = "Watch Flow";
  } else if (recommendation.includes("Sell") && regime === "risk_on" && (relativeStrengthBroad20 || 0) > -5) {
    recommendation = "Watch Flow";
  }

  return {
    symbol,
    shortName: snapshot.shortName,
    recommendation,
    score,
    confidence: Math.abs(score) >= 6 ? "High" : Math.abs(score) >= 3 ? "Medium" : "Low",
    summary: summary.slice(0, 4),
    metrics: {
      price: snapshot.latestClose,
      latestVolume: snapshot.latest.volume ?? null,
      avgVolume20: snapshot.avgVolume20,
      volumeRatio20: snapshot.volumeRatio20,
      priceChangePct: snapshot.priceChangePct,
      return5dPct: snapshot.return5dPct,
      return20dPct: snapshot.return20dPct,
      rsi14: snapshot.rsi14,
      relativeStrengthBroad20,
      relativeStrengthSector20,
      marketRegime: regime,
    },
  };
}

function buildTrendingRecommendation(symbol, history) {
  const snapshot = buildFlowSnapshot(symbol, history);
  const activityScore =
    Math.abs(snapshot.return5dPct || 0) * 0.7 +
    Math.abs(snapshot.return20dPct || 0) * 0.35 +
    Math.max((snapshot.volumeRatio20 || 1) - 1, 0) * 12 +
    Math.abs(snapshot.priceChangePct || 0) * 0.6;
  const bias =
    (snapshot.return5dPct || 0) >= 4 && (snapshot.volumeRatio20 || 0) >= 1.2
      ? "Buy Pressure"
      : (snapshot.return5dPct || 0) <= -4 && (snapshot.volumeRatio20 || 0) >= 1.2
        ? "Sell Pressure"
        : (snapshot.return20dPct || 0) >= 0
          ? "Momentum Watch"
          : "Risk Watch";

  return {
    symbol,
    shortName: snapshot.shortName,
    recommendation: bias,
    activityScore,
    summary: [
      `Five-day move ${formatPercent(snapshot.return5dPct)} with 20-day move at ${formatPercent(snapshot.return20dPct)}.`,
      snapshot.volumeRatio20 == null
        ? "Volume baseline unavailable."
        : `Current volume is ${snapshot.volumeRatio20.toFixed(1)}x the 20-day average.`,
      snapshot.rsi14 == null ? "RSI unavailable." : `RSI is ${snapshot.rsi14.toFixed(1)}.`,
    ],
    metrics: {
      price: snapshot.latestClose,
      latestVolume: snapshot.latest.volume ?? null,
      volumeRatio20: snapshot.volumeRatio20,
      priceChangePct: snapshot.priceChangePct,
      return5dPct: snapshot.return5dPct,
      return20dPct: snapshot.return20dPct,
      return60dPct: snapshot.return60dPct,
    },
  };
}

function extractSymbolCandidates(message) {
  return [...new Set((message.match(/\b[A-Z]{1,5}\b/g) || []).map((value) => value.trim().toUpperCase()))];
}

function normalizeStockQueryFromMessage(message) {
  return String(message || "")
    .replace(/[?.,!]/g, " ")
    .replace(
      /\b(what|how|does|do|is|are|the|next|few|days|look|like|for|about|showing|more|right|now|support|a|an|and|or|stock|shares|ticker|company|trend|trends|market|sentiment|news|supply|demand|over|session|sessions|check|breakout|breakdowns|breakdown|risk|risky|few|sessions|session|in|on|at|of)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveStockFromMessage(message) {
  const symbolCandidates = extractSymbolCandidates(message);
  for (const symbol of symbolCandidates) {
    const result = await tryFetchHistory(symbol, "6mo");
    if (result.ok) {
      return { symbol, history: result.history };
    }
  }

  const searchQueries = [...new Set([normalizeStockQueryFromMessage(message), String(message || "").trim()].filter(Boolean))];
  for (const query of searchQueries) {
    const searchResults = await fetchSearchResults(query);
    const firstEquity =
      searchResults.find((item) => ["EQUITY", "ETF", "MUTUALFUND"].includes((item.type || "").toUpperCase())) || searchResults[0];
    if (!firstEquity) {
      continue;
    }

    const historyResult = await tryFetchHistory(firstEquity.symbol, "6mo");
    if (!historyResult.ok) {
      continue;
    }

    return {
      symbol: firstEquity.symbol,
      history: historyResult.history,
      resolvedFrom: query,
    };
  }

  if (!searchQueries.length) {
    throw new Error("I could not identify a stock symbol from that message. Try naming the ticker directly, like NVDA or AAPL.");
  }

  throw new Error("I could not identify a stock from that message. Try a clearer company name or ticker, like Nvidia or NVDA.");
}

function scoreTextSentiment(text) {
  const value = String(text || "").toLowerCase();
  const positiveTerms = [
    "beat",
    "surge",
    "gain",
    "growth",
    "bullish",
    "upside",
    "strong",
    "record",
    "expand",
    "rise",
    "rally",
    "demand",
    "upgrade",
  ];
  const negativeTerms = [
    "miss",
    "drop",
    "fall",
    "weak",
    "cut",
    "downgrade",
    "lawsuit",
    "slowdown",
    "risk",
    "concern",
    "decline",
    "selloff",
    "warn",
  ];

  let score = 0;
  positiveTerms.forEach((term) => {
    if (value.includes(term)) {
      score += 1;
    }
  });
  negativeTerms.forEach((term) => {
    if (value.includes(term)) {
      score -= 1;
    }
  });
  return score;
}

async function fetchNewsForSymbol(symbol, shortName = "") {
  const payload = await fetchSearchPayload(`${symbol} ${shortName}`.trim(), {
    quotesCount: 0,
    newsCount: 8,
  });
  const news = (payload.news || []).slice(0, 6).map((item) => {
    const title = getText(item.title);
    const publisher = getText(item.publisher || item.providerName);
    const summary = getText(item.summary || item.snippet);
    const link = getText(item.link);
    const publishedAt = item.providerPublishTime ? new Date(item.providerPublishTime * 1000).toISOString() : null;
    return {
      title,
      publisher,
      summary,
      link,
      publishedAt,
      sentimentScore: scoreTextSentiment(`${title} ${summary}`),
    };
  });

  const aggregate = news.reduce((sum, item) => sum + item.sentimentScore, 0);
  const sentiment =
    aggregate >= 2 ? "Positive" : aggregate <= -2 ? "Negative" : news.length ? "Mixed" : "Neutral";

  return {
    sentiment,
    aggregateScore: aggregate,
    news,
  };
}

function classifySupplyDemand(snapshot) {
  const volumeRatio = snapshot.volumeRatio20 || 0;
  const fiveDayMove = snapshot.return5dPct || 0;
  const priceChange = snapshot.priceChangePct || 0;

  if (volumeRatio >= 1.5 && fiveDayMove >= 3 && priceChange >= 0) {
    return {
      label: "Demand-led",
      summary: `Buy-side pressure is visible with ${volumeRatio.toFixed(1)}x relative volume and a ${formatPercent(fiveDayMove)} five-day move.`,
    };
  }

  if (volumeRatio >= 1.5 && fiveDayMove <= -3 && priceChange <= 0) {
    return {
      label: "Supply-heavy",
      summary: `Selling pressure is elevated with ${volumeRatio.toFixed(1)}x relative volume and a ${formatPercent(fiveDayMove)} five-day move.`,
    };
  }

  return {
    label: "Balanced",
    summary: volumeRatio >= 1.1
      ? `Volume is active at ${volumeRatio.toFixed(1)}x normal, but price follow-through is not one-sided.`
      : "Volume and price action look balanced rather than strongly one-sided.",
  };
}

function buildNearTermOutlook(shortTermRecommendation, technicalRecommendation, newsSentiment, supplyDemand) {
  const shortBias = shortTermRecommendation.bias;
  const shortAction = shortTermRecommendation.recommendation;
  const technicalLabel = technicalRecommendation.recommendation;

  if (
    shortBias === "Long" &&
    ["Action Now", "Near Trigger"].includes(shortAction) &&
    (technicalLabel.includes("Buy") || technicalLabel === "Watch") &&
    newsSentiment !== "Negative" &&
    supplyDemand.label !== "Supply-heavy"
  ) {
    return {
      label: "Bullish lean",
      summary: "The next-few-days bias is higher, but only if momentum holds and the trigger level stays intact.",
    };
  }

  if (
    shortBias === "Short" &&
    ["Action Now", "Near Trigger"].includes(shortAction) &&
    (technicalLabel.includes("Sell") || technicalLabel === "Watch") &&
    newsSentiment !== "Positive" &&
    supplyDemand.label !== "Demand-led"
  ) {
    return {
      label: "Bearish lean",
      summary: "The next-few-days bias is lower, with selling pressure still in control unless price quickly reclaims the short-term trend.",
    };
  }

  return {
    label: "Mixed / watch",
    summary: "The setup is not clean enough for a strong directional call over the next few days. Treat it as a watchlist name rather than a conviction trade.",
  };
}

function buildChatResponse(message, symbol, shortName, shortTermRecommendation, technicalRecommendation, newsSnapshot, supplyDemand) {
  const outlook = buildNearTermOutlook(
    shortTermRecommendation,
    technicalRecommendation,
    newsSnapshot.sentiment,
    supplyDemand
  );
  const trigger = shortTermRecommendation.metrics.triggerPrice;
  const stop = shortTermRecommendation.metrics.stopPrice;
  const target = shortTermRecommendation.metrics.targetPrice;

  const paragraphs = [
    `${shortName} (${symbol}) currently reads as a ${outlook.label.toLowerCase()} setup. ${outlook.summary}`,
    `Short-term setup: ${shortTermRecommendation.setupType} with ${shortTermRecommendation.recommendation.toLowerCase()} status and a ${shortTermRecommendation.bias.toLowerCase()} bias. The broader technical engine is at ${technicalRecommendation.recommendation.toLowerCase()}, which keeps the higher-timeframe context ${technicalRecommendation.metrics.marketRegime === "risk_on" ? "supportive" : technicalRecommendation.metrics.marketRegime === "risk_off" ? "defensive" : "mixed"}.`,
    `Sentiment from recent headlines is ${newsSnapshot.sentiment.toLowerCase()}. ${supplyDemand.summary}`,
    trigger != null && stop != null && target != null
      ? `If you are thinking about the next few days rather than a long hold, the practical levels are roughly trigger ${trigger.toFixed(2)}, stop ${stop.toFixed(2)}, and first target ${target.toFixed(2)}.`
      : "The setup has directional context, but the trigger, stop, and target levels are not clean enough to frame a precise short-term trade.",
    "This is a rule-based market read from trend, volume, relative strength, and recent headlines. It is not a guaranteed prediction or financial advice.",
  ];

  return {
    symbol,
    shortName,
    message,
    outlook: outlook.label,
    paragraphs,
    technicalRecommendation,
    shortTermRecommendation,
    newsSentiment: newsSnapshot.sentiment,
    supplyDemand: supplyDemand.label,
    headlineNews: newsSnapshot.news.slice(0, 3),
    suggestedPrompts: [
      `What changes the next few days for ${symbol}?`,
      `Is ${symbol} showing demand or distribution right now?`,
      `Does the current news support a breakout for ${symbol}?`,
    ],
  };
}

function serveStatic(reqPath, res) {
  const relativePath = STATIC_ROUTE_ALIASES[reqPath] || reqPath;
  const normalizedPath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalizedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendJson(res, 404, { error: "Not found" });
        return;
      }
      sendJson(res, 500, { error: "Failed to read file" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === "/health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      port: Number(PORT),
      dataDir: DATA_DIR,
    });
    return;
  }

  if (requestUrl.pathname === "/api/history" && req.method === "GET") {
    const symbol = safeSymbol(requestUrl.searchParams.get("symbol"));
    const range = safeRange(requestUrl.searchParams.get("range"));
    if (!symbol) {
      sendJson(res, 400, { error: "Missing stock symbol." });
      return;
    }

    try {
      const data = await fetchHistory(symbol, range);
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === "/api/symbol-search" && req.method === "GET") {
    const query = safeSearchQuery(requestUrl.searchParams.get("q"));
    if (query.length < 1) {
      sendJson(res, 200, { results: [] });
      return;
    }

    try {
      const results = await fetchSearchResults(query);
      sendJson(res, 200, { results });
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === "/api/symbols" && req.method === "GET") {
    const activeWatchlist = normalizeWatchlistId(requestUrl.searchParams.get("watchlist"));
    if (activeWatchlist == null) {
      sendJson(res, 400, { error: "Invalid watchlist selection." });
      return;
    }
    sendJson(res, 200, {
      activeWatchlist,
      symbols: listStoredSymbols(activeWatchlist),
      watchlists: listWatchlists(),
    });
    return;
  }

  if (requestUrl.pathname === "/api/recommendations/technical" && req.method === "GET") {
    const activeWatchlist = normalizeWatchlistId(requestUrl.searchParams.get("watchlist"));
    if (activeWatchlist == null) {
      sendJson(res, 400, { error: "Invalid watchlist selection." });
      return;
    }
    const symbols = listStoredSymbols(activeWatchlist);
    if (!symbols.length) {
      sendJson(res, 200, { activeWatchlist, requestedSymbols: [], recommendations: [], skippedSymbols: [], watchlists: listWatchlists() });
      return;
    }

    try {
      const historyResults = await Promise.all(symbols.map((symbol) => tryFetchHistory(symbol, "1y")));
      const validHistories = historyResults.filter((result) => result.ok);
      const skippedSymbols = historyResults
        .filter((result) => !result.ok)
        .map((result) => ({ symbol: result.symbol, error: result.error }));

      if (!validHistories.length) {
        sendJson(res, 502, {
          error: "Unable to load market data for any saved symbols.",
          skippedSymbols,
        });
        return;
      }

      const marketContext = await fetchBenchmarkContext(validHistories.map((result) => result.symbol), "1y");
      const recommendations = validHistories.map((result) =>
        buildTechnicalRecommendation(result.symbol, result.history, marketContext)
      );
      sendJson(res, 200, {
        activeWatchlist,
        requestedSymbols: symbols,
        recommendations,
        skippedSymbols,
        watchlists: listWatchlists(),
      });
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === "/api/recommendations/short-term" && req.method === "GET") {
    const activeWatchlist = normalizeWatchlistId(requestUrl.searchParams.get("watchlist"));
    if (activeWatchlist == null) {
      sendJson(res, 400, { error: "Invalid watchlist selection." });
      return;
    }
    const symbols = listStoredSymbols(activeWatchlist);
    if (!symbols.length) {
      sendJson(res, 200, {
        activeWatchlist,
        requestedSymbols: [],
        recommendations: [],
        skippedSymbols: [],
        watchlists: listWatchlists(),
      });
      return;
    }

    try {
      const historyResults = await Promise.all(symbols.map((symbol) => tryFetchHistory(symbol, "1y")));
      const validHistories = historyResults.filter((result) => result.ok);
      const skippedSymbols = historyResults
        .filter((result) => !result.ok)
        .map((result) => ({ symbol: result.symbol, error: result.error }));

      if (!validHistories.length) {
        sendJson(res, 502, {
          error: "Unable to load market data for any saved symbols.",
          skippedSymbols,
        });
        return;
      }

      const marketContext = await fetchBenchmarkContext(validHistories.map((result) => result.symbol), "1y");
      const recommendations = validHistories.map((result) =>
        buildShortTermRecommendation(result.symbol, result.history, marketContext)
      );
      sendJson(res, 200, {
        activeWatchlist,
        requestedSymbols: symbols,
        recommendations,
        skippedSymbols,
        watchlists: listWatchlists(),
      });
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === "/api/backtest/technical" && req.method === "GET") {
    const activeWatchlist = normalizeWatchlistId(requestUrl.searchParams.get("watchlist"));
    if (activeWatchlist == null) {
      sendJson(res, 400, { error: "Invalid watchlist selection." });
      return;
    }
    const symbols = listStoredSymbols(activeWatchlist);
    if (!symbols.length) {
      if (requestUrl.searchParams.get("format") === "csv") {
        sendCsv(res, 200, "technical-backtest.csv", "symbol\n");
        return;
      }
      sendJson(res, 200, { activeWatchlist, requestedSymbols: [], summary: [], directionSummary: [], symbols: [], skippedSymbols: [], watchlists: listWatchlists() });
      return;
    }

    try {
      const symbolHistoryResults = await Promise.all(
        symbols.map((symbol) => tryFetchHistory(symbol, BACKTEST_LOOKBACK_RANGE))
      );
      const validSymbolHistories = symbolHistoryResults.filter((result) => result.ok);
      const skippedSymbols = symbolHistoryResults
        .filter((result) => !result.ok)
        .map((result) => ({ symbol: result.symbol, error: result.error }));

      if (!validSymbolHistories.length) {
        if (requestUrl.searchParams.get("format") === "csv") {
          sendCsv(res, 200, "technical-backtest.csv", "symbol\n");
          return;
        }
        sendJson(res, 502, {
          error: "Unable to load market data for any saved symbols.",
          skippedSymbols,
          summary: [],
          directionSummary: [],
          symbols: [],
        });
        return;
      }

      const benchmarkSymbols = new Set([BENCHMARKS.broad, BENCHMARKS.growth]);
      validSymbolHistories.forEach((result) => benchmarkSymbols.add(getBenchmarkSymbolForStock(result.symbol)));

      const benchmarkEntries = await Promise.all(
        [...benchmarkSymbols].map(async (symbol) => [symbol, await fetchHistory(symbol, BACKTEST_LOOKBACK_RANGE)])
      );
      const benchmarkHistories = Object.fromEntries(benchmarkEntries);
      const backtests = validSymbolHistories.map((result) =>
        backtestTechnicalHistory(result.symbol, result.history, benchmarkHistories)
      );

      const mergedBuckets = new Map();
      backtests.forEach((entry) => {
        Object.entries(entry.byRecommendation || {}).forEach(([label, stats]) => {
          if (!mergedBuckets.has(label)) {
            mergedBuckets.set(label, []);
          }

          mergedBuckets.get(label).push(stats);
        });
      });

      const summary = [...mergedBuckets.entries()].map(([label, statsList]) => ({
        recommendation: label,
        totalSignals: statsList.reduce((sum, stats) => sum + stats.totalSignals, 0),
        hitRate5d:
          statsList.reduce((sum, stats) => sum + stats.hitRate5d * stats.totalSignals, 0) /
          statsList.reduce((sum, stats) => sum + stats.totalSignals, 0),
        hitRate20d:
          statsList.reduce((sum, stats) => sum + stats.hitRate20d * stats.totalSignals, 0) /
          statsList.reduce((sum, stats) => sum + stats.totalSignals, 0),
        alphaHitRate20d:
          statsList.reduce((sum, stats) => sum + (stats.alphaHitRate20d || 0) * stats.totalSignals, 0) /
          statsList.reduce((sum, stats) => sum + stats.totalSignals, 0),
        avgReturn5d:
          statsList.reduce((sum, stats) => sum + stats.avgReturn5d * stats.totalSignals, 0) /
          statsList.reduce((sum, stats) => sum + stats.totalSignals, 0),
        avgReturn20d:
          statsList.reduce((sum, stats) => sum + stats.avgReturn20d * stats.totalSignals, 0) /
          statsList.reduce((sum, stats) => sum + stats.totalSignals, 0),
        avgAlpha20d:
          statsList.reduce((sum, stats) => sum + (stats.avgAlpha20d || 0) * stats.totalSignals, 0) /
          statsList.reduce((sum, stats) => sum + stats.totalSignals, 0),
        avgNet20d:
          statsList.reduce((sum, stats) => sum + (stats.avgNet20d || 0) * stats.totalSignals, 0) /
          statsList.reduce((sum, stats) => sum + stats.totalSignals, 0),
        avgAlphaNet20d:
          statsList.reduce((sum, stats) => sum + (stats.avgAlphaNet20d || 0) * stats.totalSignals, 0) /
          statsList.reduce((sum, stats) => sum + stats.totalSignals, 0),
      }));

      const mergedDirections = new Map();
      backtests.forEach((entry) => {
        Object.entries(entry.byDirection || {}).forEach(([label, stats]) => {
          if (!mergedDirections.has(label)) {
            mergedDirections.set(label, []);
          }

          mergedDirections.get(label).push(stats);
        });
      });

      const directionSummary = [...mergedDirections.entries()].map(([label, statsList]) => ({
        direction: label,
        totalSignals: statsList.reduce((sum, stats) => sum + stats.totalSignals, 0),
        hitRate20d:
          statsList.reduce((sum, stats) => sum + stats.hitRate20d * stats.totalSignals, 0) /
          statsList.reduce((sum, stats) => sum + stats.totalSignals, 0),
        alphaHitRate20d:
          statsList.reduce((sum, stats) => sum + (stats.alphaHitRate20d || 0) * stats.totalSignals, 0) /
          statsList.reduce((sum, stats) => sum + stats.totalSignals, 0),
        avgNet20d:
          statsList.reduce((sum, stats) => sum + (stats.avgNet20d || 0) * stats.totalSignals, 0) /
          statsList.reduce((sum, stats) => sum + stats.totalSignals, 0),
        avgAlphaNet20d:
          statsList.reduce((sum, stats) => sum + (stats.avgAlphaNet20d || 0) * stats.totalSignals, 0) /
          statsList.reduce((sum, stats) => sum + stats.totalSignals, 0),
      }));

      if (requestUrl.searchParams.get("format") === "csv") {
        const rows = [
          [
            "symbol",
            "as_of_date",
            "recommendation",
            "direction",
            "score",
            "regime",
            "benchmark_symbol",
            "asset_return_5d",
            "asset_return_20d",
            "benchmark_return_5d",
            "benchmark_return_20d",
            "strategy_net_5d",
            "strategy_net_20d",
            "alpha_net_5d",
            "alpha_net_20d",
            "transaction_cost_pct",
          ].join(","),
        ];

        backtests.forEach((entry) => {
          entry.records.forEach((record) => {
            rows.push(
              [
                entry.symbol,
                record.asOfDate,
                record.recommendation,
                record.direction,
                record.score,
                record.regime,
                record.benchmarkSymbol,
                record.assetReturn5d,
                record.assetReturn20d,
                record.benchmarkReturn5d,
                record.benchmarkReturn20d,
                record.strategyNet5d,
                record.strategyNet20d,
                record.alphaNet5d,
                record.alphaNet20d,
                record.transactionCostPct,
              ].join(",")
            );
          });
        });

        sendCsv(res, 200, "technical-backtest.csv", rows.join("\n"));
        return;
      }

      sendJson(res, 200, {
        activeWatchlist,
        requestedSymbols: symbols,
        summary,
        directionSummary,
        symbols: backtests,
        skippedSymbols,
        watchlists: listWatchlists(),
      });
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === "/api/recommendations/institutional" && req.method === "GET") {
    try {
      const marketContext = await fetchBenchmarkContext(MARKET_FLOW_UNIVERSE, "1y");
      const recommendations = await Promise.all(
        MARKET_FLOW_UNIVERSE.map(async (symbol) =>
          buildMarketFlowRecommendation(symbol, await fetchHistory(symbol, "3mo"), marketContext)
        )
      );
      sendJson(res, 200, { recommendations: recommendations.sort((left, right) => right.score - left.score).slice(0, 12) });
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === "/api/recommendations/trending" && req.method === "GET") {
    try {
      const recommendations = await Promise.all(
        MARKET_FLOW_UNIVERSE.map(async (symbol) => buildTrendingRecommendation(symbol, await fetchHistory(symbol, "3mo")))
      );
      sendJson(res, 200, {
        recommendations: recommendations.sort((left, right) => right.activityScore - left.activityScore).slice(0, 20),
      });
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === "/api/market-chat" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const message = String(body.message || "").trim();
      if (!message) {
        sendJson(res, 400, { error: "Ask about a stock symbol or company name." });
        return;
      }

      const resolved = await resolveStockFromMessage(message);
      const oneYearHistory = await fetchHistory(resolved.symbol, "1y");
      const marketContext = await fetchBenchmarkContext([resolved.symbol], "1y");
      const shortTermRecommendation = buildShortTermRecommendation(resolved.symbol, oneYearHistory, marketContext);
      const technicalRecommendation = buildTechnicalRecommendation(resolved.symbol, oneYearHistory, marketContext);
      const newsSnapshot = await fetchNewsForSymbol(resolved.symbol, oneYearHistory.shortName || resolved.symbol);
      const supplyDemand = classifySupplyDemand(buildFlowSnapshot(resolved.symbol, oneYearHistory));
      const response = buildChatResponse(
        message,
        resolved.symbol,
        oneYearHistory.shortName || resolved.symbol,
        shortTermRecommendation,
        technicalRecommendation,
        newsSnapshot,
        supplyDemand
      );

      sendJson(res, 200, response);
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === "/api/watchlists" && req.method === "GET") {
    sendJson(res, 200, { watchlists: listWatchlists() });
    return;
  }

  if (requestUrl.pathname === "/api/watchlists" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const name = safeWatchlistName(body.name);
      if (!name) {
        sendJson(res, 400, { error: "Missing watchlist name." });
        return;
      }

      db.prepare("INSERT INTO watchlists (name, sort_order) VALUES (?, ?)").run(name, getNextWatchlistSortOrder());
      sendJson(res, 200, { watchlists: listWatchlists() });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname.startsWith("/api/watchlists/") && req.method === "DELETE") {
    const rawId = requestUrl.pathname.slice("/api/watchlists/".length);
    const watchlistId = normalizeWatchlistId(rawId);
    if (watchlistId == null || watchlistId === "all") {
      sendJson(res, 400, { error: "Invalid watchlist selection." });
      return;
    }

    const watchlist = getWatchlistById(watchlistId);
    if (!watchlist) {
      sendJson(res, 404, { error: "Watchlist not found." });
      return;
    }

    if (watchlist.name === DEFAULT_WATCHLIST_NAME) {
      sendJson(res, 400, { error: "The Core watchlist cannot be deleted." });
      return;
    }

    const defaultWatchlist = getDefaultWatchlist();
    if (!defaultWatchlist) {
      sendJson(res, 500, { error: "Core watchlist is unavailable." });
      return;
    }

    const symbolsToMove = listStoredSymbols(watchlistId);
    symbolsToMove.forEach((symbol) => {
      db.prepare("DELETE FROM watchlist_symbols WHERE symbol = ?").run(symbol);
      db.prepare("INSERT INTO watchlist_symbols (watchlist_id, symbol, sort_order) VALUES (?, ?, ?)").run(
        defaultWatchlist.id,
        symbol,
        getNextSymbolSortOrder(defaultWatchlist.id)
      );
    });

    db.prepare("DELETE FROM watchlists WHERE id = ?").run(watchlistId);
    sendJson(res, 200, {
      deletedWatchlistId: watchlistId,
      movedSymbols: symbolsToMove,
      watchlists: listWatchlists(),
    });
    return;
  }

  if (requestUrl.pathname === "/api/symbols" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const symbol = safeSymbol(body.symbol);
      const watchlistId = normalizeWatchlistId(body.watchlistId);
      if (!symbol) {
        sendJson(res, 400, { error: "Missing stock symbol." });
        return;
      }
      if (watchlistId == null || watchlistId === "all") {
        sendJson(res, 400, { error: "Choose a specific watchlist for new symbols." });
        return;
      }
      if (!getWatchlistById(watchlistId)) {
        sendJson(res, 404, { error: "Watchlist not found." });
        return;
      }

      db.prepare("DELETE FROM watchlist_symbols WHERE symbol = ?").run(symbol);
      db.prepare("INSERT INTO watchlist_symbols (watchlist_id, symbol, sort_order) VALUES (?, ?, ?)").run(
        watchlistId,
        symbol,
        getNextSymbolSortOrder(watchlistId)
      );
      sendJson(res, 200, {
        symbol,
        activeWatchlist: watchlistId,
        symbols: listStoredSymbols(watchlistId),
        watchlists: listWatchlists(),
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === "/api/symbols/order" && req.method === "PUT") {
    try {
      const body = await readJsonBody(req);
      const watchlistId = normalizeWatchlistId(body.watchlistId);
      const symbols = Array.isArray(body.symbols) ? body.symbols.map(safeSymbol).filter(Boolean) : [];
      if (watchlistId == null || watchlistId === "all") {
        sendJson(res, 400, { error: "Choose a specific watchlist to reorder." });
        return;
      }
      const storedSymbols = listStoredSymbols(watchlistId);

      if (symbols.length !== storedSymbols.length) {
        sendJson(res, 400, { error: "Order payload does not match stored symbols." });
        return;
      }

      const requestedSet = new Set(symbols);
      if (requestedSet.size !== storedSymbols.length || storedSymbols.some((symbol) => !requestedSet.has(symbol))) {
        sendJson(res, 400, { error: "Order payload contains invalid symbols." });
        return;
      }

      replaceSymbolOrder(watchlistId, symbols);
      sendJson(res, 200, { activeWatchlist: watchlistId, symbols: listStoredSymbols(watchlistId), watchlists: listWatchlists() });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname.startsWith("/api/symbols/") && req.method === "DELETE") {
    const symbol = safeSymbol(decodeURIComponent(requestUrl.pathname.slice("/api/symbols/".length)));
    const watchlistId = normalizeWatchlistId(requestUrl.searchParams.get("watchlist"));
    if (!symbol) {
      sendJson(res, 400, { error: "Missing stock symbol." });
      return;
    }
    if (watchlistId == null) {
      sendJson(res, 400, { error: "Invalid watchlist selection." });
      return;
    }

    if (watchlistId === "all") {
      db.prepare("DELETE FROM watchlist_symbols WHERE symbol = ?").run(symbol);
      sendJson(res, 200, { symbol, activeWatchlist: "all", symbols: listStoredSymbols("all"), watchlists: listWatchlists() });
      return;
    }

    db.prepare("DELETE FROM watchlist_symbols WHERE watchlist_id = ? AND symbol = ?").run(watchlistId, symbol);
    sendJson(res, 200, {
      symbol,
      activeWatchlist: watchlistId,
      symbols: listStoredSymbols(watchlistId),
      watchlists: listWatchlists(),
    });
    return;
  }

  serveStatic(requestUrl.pathname, res);
});

server.listen(PORT, () => {
  console.log(`Stock dashboard running at http://localhost:${PORT}`);
});
