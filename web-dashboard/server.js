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

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
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

function listStoredSymbols() {
  return db
    .prepare("SELECT symbol FROM symbols ORDER BY sort_order ASC, created_at ASC, symbol ASC")
    .all()
    .map((row) => row.symbol);
}

function getNextSortOrder() {
  const row = db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM symbols").get();
  return row.next_order;
}

function replaceSymbolOrder(symbols) {
  const updateStmt = db.prepare("UPDATE symbols SET sort_order = ? WHERE symbol = ?");
  symbols.forEach((symbol, index) => {
    updateStmt.run(index + 1, symbol);
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

function buildSearchUrl(baseUrl, query) {
  const target = new URL(`${baseUrl}/v1/finance/search`);
  target.searchParams.set("q", query);
  target.searchParams.set("quotesCount", "8");
  target.searchParams.set("newsCount", "0");
  target.searchParams.set("enableFuzzyQuery", "false");
  target.searchParams.set("quotesQueryId", "tss_match_phrase_query");
  target.searchParams.set("multiQuoteQueryId", "multi_quote_single_token_query");
  target.searchParams.set("enableEnhancedTrivialQuery", "true");
  return target;
}

async function fetchSearchResults(query) {
  const errors = [];

  for (const baseUrl of YAHOO_SEARCH_HOSTS) {
    const target = buildSearchUrl(baseUrl, query);
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

        const payload = await response.json();
        return (payload.quotes || [])
          .filter((quote) => quote.symbol && !quote.symbol.includes("="))
          .map((quote) => ({
            symbol: quote.symbol,
            shortName: quote.shortname || quote.longname || quote.symbol,
            exchange: quote.exchange || quote.exchDisp || "",
            type: quote.quoteType || "",
          }));
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const message = error.name === "AbortError" ? "Upstream request timed out." : error.message;
      errors.push(`${baseUrl}: ${message}`);
      console.error(`[symbol-search] ${query} failed via ${baseUrl}: ${message}`);
    }
  }

  throw new Error(`Unable to search symbols. ${errors.join(" | ")}`);
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

function buildTechnicalRecommendation(symbol, history) {
  const closes = history.points.map((point) => point.close).filter((value) => value != null);
  const volumes = history.points.map((point) => point.volume || 0);
  const latest = history.points[history.points.length - 1];
  const previous = history.points[history.points.length - 2] || latest;
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

  if (sma20 != null && latestClose > sma20) {
    score += 1;
    scoreNotes.push(`Price is above the 20-day average by ${formatPercent(((latestClose - sma20) / sma20) * 100)}.`);
  } else if (sma20 != null) {
    score -= 1;
    scoreNotes.push(`Price is below the 20-day average by ${formatPercent(((latestClose - sma20) / sma20) * 100)}.`);
  }

  if (sma50 != null && sma20 != null && sma20 > sma50) {
    score += 1;
    scoreNotes.push("Short-term trend is stronger than the 50-day trend.");
  } else if (sma50 != null && sma20 != null) {
    score -= 1;
    scoreNotes.push("Short-term trend is lagging the 50-day trend.");
  }

  if (sma200 != null && latestClose > sma200) {
    score += 1;
    scoreNotes.push("Price is trading above the long-term 200-day trend.");
  } else if (sma200 != null) {
    score -= 1;
    scoreNotes.push("Price is under the long-term 200-day trend.");
  }

  if (rsi14 != null && rsi14 >= 52 && rsi14 <= 68) {
    score += 1;
    scoreNotes.push(`RSI is constructive at ${rsi14.toFixed(1)}.`);
  } else if (rsi14 != null && rsi14 >= 75) {
    score -= 1;
    scoreNotes.push(`RSI is stretched at ${rsi14.toFixed(1)}.`);
  } else if (rsi14 != null && rsi14 <= 38) {
    score -= 1;
    scoreNotes.push(`RSI remains weak at ${rsi14.toFixed(1)}.`);
  }

  if (macd.histogram != null && macd.histogram > 0) {
    score += 1;
    scoreNotes.push("MACD momentum remains positive.");
  } else if (macd.histogram != null && macd.histogram < 0) {
    score -= 1;
    scoreNotes.push("MACD momentum is negative.");
  }

  if (latestClose >= recentHigh) {
    score += 1;
    scoreNotes.push("Price is pressing a 20-session breakout zone.");
  } else if (latestClose <= recentLow) {
    score -= 1;
    scoreNotes.push("Price is testing a 20-session breakdown zone.");
  }

  if (avgVolume20 != null && latest.volume != null && latest.volume > avgVolume20 * 1.35) {
    if ((priceChange || 0) >= 0) {
      score += 1;
      scoreNotes.push("Volume expanded on an up move, which supports demand.");
    } else {
      score -= 1;
      scoreNotes.push("Volume expanded on a down move, which points to distribution.");
    }
  }

  if (monthReturn != null && monthReturn >= 6) {
    score += 1;
    scoreNotes.push(`One-month return is strong at ${formatPercent(monthReturn)}.`);
  } else if (monthReturn != null && monthReturn <= -6) {
    score -= 1;
    scoreNotes.push(`One-month return is weak at ${formatPercent(monthReturn)}.`);
  }

  if (bollingerUpper != null && latestClose > bollingerUpper) {
    score -= 1;
    scoreNotes.push("Price is above the upper Bollinger band and may be overextended.");
  } else if (bollingerLower != null && latestClose < bollingerLower) {
    score += 1;
    scoreNotes.push("Price is below the lower Bollinger band and may be washout-level oversold.");
  }

  let recommendation = "Hold";
  if (score >= 5) {
    recommendation = "Strong Buy";
  } else if (score >= 2) {
    recommendation = "Buy";
  } else if (score <= -5) {
    recommendation = "Strong Sell";
  } else if (score <= -2) {
    recommendation = "Sell";
  }

  return {
    symbol,
    shortName: history.shortName || symbol,
    recommendation,
    score,
    confidence: Math.abs(score) >= 5 ? "High" : Math.abs(score) >= 3 ? "Medium" : "Low",
    summary: scoreNotes.slice(0, 4),
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
    },
  };
}

function buildMarketFlowRecommendation(symbol, history) {
  const snapshot = buildFlowSnapshot(symbol, history);
  const summary = [];
  let score = 0;

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
    sendJson(res, 200, { symbols: listStoredSymbols() });
    return;
  }

  if (requestUrl.pathname === "/api/recommendations/technical" && req.method === "GET") {
    const symbols = listStoredSymbols();
    if (!symbols.length) {
      sendJson(res, 200, { recommendations: [] });
      return;
    }

    try {
      const recommendations = await Promise.all(
        symbols.map(async (symbol) => buildTechnicalRecommendation(symbol, await fetchHistory(symbol, "1y")))
      );
      sendJson(res, 200, { recommendations });
    } catch (error) {
      sendJson(res, 502, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === "/api/recommendations/institutional" && req.method === "GET") {
    try {
      const recommendations = await Promise.all(
        MARKET_FLOW_UNIVERSE.map(async (symbol) => buildMarketFlowRecommendation(symbol, await fetchHistory(symbol, "3mo")))
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

  if (requestUrl.pathname === "/api/symbols" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const symbol = safeSymbol(body.symbol);
      if (!symbol) {
        sendJson(res, 400, { error: "Missing stock symbol." });
        return;
      }

      db.prepare("INSERT OR IGNORE INTO symbols (symbol, sort_order) VALUES (?, ?)").run(
        symbol,
        getNextSortOrder()
      );
      sendJson(res, 200, { symbol, symbols: listStoredSymbols() });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === "/api/symbols/order" && req.method === "PUT") {
    try {
      const body = await readJsonBody(req);
      const symbols = Array.isArray(body.symbols) ? body.symbols.map(safeSymbol).filter(Boolean) : [];
      const storedSymbols = listStoredSymbols();

      if (symbols.length !== storedSymbols.length) {
        sendJson(res, 400, { error: "Order payload does not match stored symbols." });
        return;
      }

      const requestedSet = new Set(symbols);
      if (requestedSet.size !== storedSymbols.length || storedSymbols.some((symbol) => !requestedSet.has(symbol))) {
        sendJson(res, 400, { error: "Order payload contains invalid symbols." });
        return;
      }

      replaceSymbolOrder(symbols);
      sendJson(res, 200, { symbols: listStoredSymbols() });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (requestUrl.pathname.startsWith("/api/symbols/") && req.method === "DELETE") {
    const symbol = safeSymbol(decodeURIComponent(requestUrl.pathname.slice("/api/symbols/".length)));
    if (!symbol) {
      sendJson(res, 400, { error: "Missing stock symbol." });
      return;
    }

    db.prepare("DELETE FROM symbols WHERE symbol = ?").run(symbol);
    sendJson(res, 200, { symbol, symbols: listStoredSymbols() });
    return;
  }

  serveStatic(requestUrl.pathname, res);
});

server.listen(PORT, () => {
  console.log(`Stock dashboard running at http://localhost:${PORT}`);
});
