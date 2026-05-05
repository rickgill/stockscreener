# StockScreener Build From Scratch

This document explains the current application as if you were rebuilding it from the ground up. It is primarily about the `web-dashboard` project, which is the deployed Node.js application in this repository.

## Project Scope

This repository contains two separate projects:

- `web-dashboard/`: the Node.js web application
- `powershell-screener/`: the PowerShell-based screener

The active production website and the features described here live under `web-dashboard/`.

## Final Product

The web application is a multi-page stock analysis workspace with:

- a landing page
- a live dashboard with saved quote widgets
- a technical signal screener
- a market flow leaders page
- a trending stocks page
- SQLite persistence for watchlists and symbols
- Yahoo Finance-backed market data
- deployment support for Railway via Docker

Routes:

- `/`
- `/dashboard`
- `/screener`
- `/institutional-flow`
- `/trending`
- `/health`

## Technology Stack

- Node.js 22
- built-in `node:http` server style code in `server.js`
- built-in `node:sqlite`
- vanilla HTML, CSS, and JavaScript on the frontend
- Yahoo Finance HTTP endpoints for quotes, chart history, and symbol search
- Docker for deployment
- Railway as the intended hosting target

There is no frontend framework and no ORM. The app is intentionally small and direct.

## Repository Layout

```text
web-dashboard/
  Dockerfile
  package.json
  README.md
  server.js
  public/
    index.html
    dashboard.html
    screener.html
    institutional-flow.html
    trending.html
    app.js
    screener.js
    institutional-flow.js
    trending.js
    signal-charts.js
    styles.css
powershell-screener/
README.md
WORK_DONE.md
BUILD_FROM_SCRATCH.md
USAGE_GUIDE.md
```

## Core Application Design

The app uses one backend file, `web-dashboard/server.js`, to do four things:

- serve the static frontend pages
- expose JSON APIs
- store watchlists and symbols in SQLite
- translate external market data into normalized data structures the frontend can render

The frontend is split by page:

- `dashboard.html` + `app.js`: live quote widgets and watchlist management
- `screener.html` + `screener.js`: technical recommendation engine and backtest UI
- `institutional-flow.html` + `institutional-flow.js`: market flow leader signals
- `trending.html` + `trending.js`: top activity and momentum names
- `signal-charts.js`: reusable inline chart rendering for signal pages
- `styles.css`: shared visual system across all pages

## Local Development Setup

### Prerequisites

- Node.js 22 or newer
- internet access for Yahoo Finance requests
- a writable data directory

### Install and run

From `web-dashboard/`:

```powershell
node server.js
```

Default local URL:

```text
http://localhost:3040
```

Health check:

```text
http://localhost:3040/health
```

### Data directory

By default the app writes SQLite data to `./data`.

You can override it:

```powershell
$env:DATA_DIR="C:\path\to\data"
node server.js
```

This is required in production so the database lives on a persistent volume.

## Database Design

The application started with a simple symbol list and later evolved to watchlists. The current model is watchlist-based.

Main tables:

- `watchlists`
- `watchlist_symbols`

Conceptually:

- `watchlists` stores the watchlist identity and display name
- `watchlist_symbols` stores the symbol membership and manual display order

The app also preserves a default watchlist:

- `Core`

Behavioral rules:

- `Core` is the default watchlist
- symbols belong to one watchlist at a time
- deleting a non-`Core` watchlist moves its symbols back to `Core`
- deleting `Core` is blocked

If legacy symbol data exists, startup migration moves it into `Core`.

## API Surface

The backend exposes a mix of static routes and JSON endpoints.

### Health and static pages

- `GET /health`
- `GET /`
- `GET /dashboard`
- `GET /screener`
- `GET /institutional-flow`
- `GET /trending`

### Watchlists and symbols

- `GET /api/watchlists`
- `POST /api/watchlists`
- `DELETE /api/watchlists/:id`
- `GET /api/symbols?watchlist=all|<id>`
- `POST /api/symbols`
- `DELETE /api/symbols/:symbol?watchlist=<id>`
- `PUT /api/symbols/order`

### Market data

- `GET /api/history`
- `GET /api/symbol-search`

### Recommendation engines

- `GET /api/recommendations/technical`
- `GET /api/backtest/technical`
- `GET /api/recommendations/institutional`
- `GET /api/recommendations/trending`

## Yahoo Finance Integration

The application relies on Yahoo Finance for:

- symbol lookup
- price history
- quote metadata
- volume and trend context

The backend uses more than one Yahoo host and includes fallback behavior. Failures for a single symbol are handled defensively so that one bad response does not blank the entire screener.

That resilience matters in production because Yahoo can return:

- `404`
- `401`
- partial quote metadata
- intermittent network failures

## Page-by-Page Build Notes

## Landing Page

Purpose:

- give the app a proper homepage instead of dropping directly into a tool page
- route users into the right workspace quickly

The landing page links to:

- Dashboard
- Signal Screener
- Market Flow Leaders
- Trending

It shares the same design system but does not depend on live market APIs.

## Dashboard Page

The dashboard is the watchlist operations page.

### Functional goals

- search for a ticker
- add it to a watchlist
- persist that choice
- show a live quote card with a chart
- auto-refresh data every 10 seconds
- let the user reorder symbols
- let the user move a symbol to a different watchlist
- support focused view of one watchlist or combined view of all watchlists

### Important UI elements

- symbol search field
- add-to-watchlist selector
- global chart range selector
- watchlist selector
- dashboard grouping selector
- create watchlist action
- delete watchlist action
- stock cards with:
  - price snapshot
  - inline chart
  - per-card range selector
  - move-to-watchlist selector
  - `Move` button
  - `Remove` button

### Grouping modes

- `Watchlist order`
- `Trend buckets`

Drag-and-drop is intentionally available only when:

- a single watchlist is selected
- grouping mode is `Watchlist order`

It is intentionally disabled in grouped read-only views because those views are for scanning, not manual ordering.

### All watchlists mode

When viewing `All watchlists`, the dashboard groups cards by watchlist so the user can see the full book without losing structure.

## Signal Screener Page

The screener evaluates saved symbols and produces action-oriented recommendations.

### Goal

Turn a passive watchlist into a ranked signal set with stronger gating than a basic moving-average screen.

### Recommendation states

- `Strong Buy`
- `Buy`
- `Watch`
- `No Trade`
- `Sell`
- `Strong Sell`
- `Skipped`

### Logic layers

The screener combines:

- moving-average structure
- RSI
- MACD-style momentum context
- volume confirmation
- breakout / trend persistence
- broad-market regime context
- sector-relative strength
- abstention logic for mixed setups
- calibration from prior same-symbol setups
- ATR-based risk framing

### Market regime filter

The app uses broad-market proxies such as `SPY` and `QQQ` to reduce false conviction. Bullish signals are downgraded in poor tape and bearish signals are softened in strong tape when the setup does not justify aggression.

### Relative strength layer

Each symbol is compared against:

- broad benchmark context
- sector ETF context where applicable

This avoids overrating a stock that is rising weakly in a strong market.

### Calibration layer

The screener does not stop at raw indicator scores. It also checks how similar historical setups for the same symbol behaved later, then surfaces:

- 5-day hit rate
- 20-day expected return
- setup sample count

### Risk framing

ATR-derived stop guidance is included so the recommendation is not just directional but also practical.

### Screener watchlist behavior

The screener uses the same watchlists as the dashboard.

It supports:

- screening one selected watchlist
- screening all watchlists together
- grouped rendering by watchlist in all-watchlists mode
- preserving dashboard symbol order in watchlist-order view

### Signal grouping modes

- `Watchlist order`
- `Signal buckets`

## Backtest Engine

The technical screener includes an on-demand backtest rather than running automatically on page load.

That decision was made because:

- backtests are the heaviest request in the app
- running them automatically hurt reliability in Railway

### Backtest outputs

- recommendation bucket summaries
- directional summaries for long, short, and flat states
- benchmark-adjusted alpha
- raw forward returns
- net returns after a turnover-cost assumption
- per-symbol tables
- CSV export

### Current backtest limits

- it is still rule-engine validation, not a full research platform
- it relies on what Yahoo history can provide
- transaction cost handling is simplified
- there is no full execution simulation or slippage model

## Market Flow Leaders Page

This page started as an institutional-flow concept, but because direct holder-detail feeds were unreliable, it evolved into a market-flow inference model.

Current purpose:

- find liquid stocks showing unusually strong buy or sell pressure characteristics

Signals are inferred from features such as:

- volume expansion
- short- and medium-term returns
- trend position
- RSI context

The page renders top-ranked names and includes inline charts for each card.

Controls:

- page-wide range selector
- per-card range selector

## Trending Page

This page is a market-wide scan for top activity names.

It surfaces a larger ranked set than the market-flow page and is intended for discovery rather than only monitoring existing watchlist symbols.

Signals are built from combinations of:

- activity
- price change
- trend
- volume behavior

The page also includes:

- inline charts
- global range selection
- per-card range selection

## Frontend Design System

The UI was deliberately moved away from a raw utilitarian layout.

Design goals:

- stronger brand feel
- cleaner top-level hierarchy
- glass-style control blocks
- more intentional spacing and typography
- consistent cross-page navigation

Shared styling lives in `public/styles.css`.

## Deployment Architecture

The production target is Railway.

### Required Railway settings

- service root: `web-dashboard`
- persistent volume mount: `/data`
- environment variable: `DATA_DIR=/data`

### Docker build

The app uses `web-dashboard/Dockerfile`.

The base image was changed from Alpine to Debian slim because the app depends on `node:sqlite`, and the Debian image is the safer production choice for that runtime requirement.

The Dockerfile also includes a build-time smoke test:

```text
node -e "require('node:sqlite')"
```

This forces deployment failures to happen early if the runtime image is incompatible.

## Production Reliability Decisions

Several changes were made specifically to keep the hosted app stable:

- skipped-symbol handling in technical screening so one invalid symbol does not fail the whole response
- on-demand backtesting instead of automatic heavy load on page open
- Docker hardening for `node:sqlite`
- synchronized frontend assets so Railway and local do not diverge
- clear watchlist-based symbol resolution between dashboard and screener

## Known Constraints

- Yahoo Finance is an unofficial upstream dependency
- some Yahoo endpoints can change behavior or return inconsistent errors
- market-flow naming is inferential, not direct proof of institutional block activity
- symbols currently belong to one watchlist at a time
- cross-watchlist drag-and-drop is not implemented

## Rebuild Sequence

If rebuilding the app from scratch, this is the correct order:

1. Create a small Node server that serves static files and exposes `/health`.
2. Add a quote history proxy endpoint using Yahoo chart data.
3. Build the dashboard with symbol add/remove, inline charts, and local range controls.
4. Add SQLite persistence for symbols and order.
5. Add drag-and-drop reorder and persist it.
6. Split the app into a landing page plus tool subpages.
7. Add the technical screener with indicator scoring.
8. Add regime, sector-relative-strength, calibration, and ATR layers.
9. Add backtesting and CSV export.
10. Add market-flow and trending pages with reusable chart widgets.
11. Replace single-symbol storage with watchlists and migrate legacy data into `Core`.
12. Add deployment hardening for Railway and persistent `/data` storage.

## Files To Read First

If a new developer needs to understand the codebase quickly, start here:

- `web-dashboard/server.js`
- `web-dashboard/public/app.js`
- `web-dashboard/public/screener.js`
- `web-dashboard/public/signal-charts.js`
- `web-dashboard/public/styles.css`

## Summary

This application is no longer just a quote dashboard. It is now a multi-page stock analysis workspace with:

- persistent watchlists
- live chart widgets
- watchlist operations
- technical signal generation
- historical validation
- market-wide discovery pages
- production deployment support

That is the current architecture and feature set someone would need to reproduce to build the same system from scratch.
