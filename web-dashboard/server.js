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

async function fetchHistory(symbol, range) {
  const rangeConfig = RANGE_CONFIG[range] || RANGE_CONFIG["6mo"];
  const target = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
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

  const response = await fetch(target, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Data request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const error = payload?.chart?.error;
  if (error) {
    throw new Error(error.description || "Unknown upstream error.");
  }

  return formatChartData(symbol, range, payload.chart);
}

function serveStatic(reqPath, res) {
  const relativePath = reqPath === "/" ? "/index.html" : reqPath;
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

  if (requestUrl.pathname === "/api/symbols" && req.method === "GET") {
    sendJson(res, 200, { symbols: listStoredSymbols() });
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
