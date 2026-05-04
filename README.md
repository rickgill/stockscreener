# Stock Screener

This repo contains two related tools:

- a local Node.js stock dashboard with draggable widgets, global and per-widget range selectors, and SQLite-backed symbol persistence
- the original PowerShell Mag 7 screener scripts for rule-based report generation

## Web dashboard

The dashboard server is in `server.js` and the frontend lives under `public/`.

Features:

- multiple stock widgets on one page
- drag-and-drop widget reordering
- global time range selection
- per-widget local time range selection
- SQLite-backed saved symbol list and widget order
- Yahoo Finance-backed historical chart data

### Run locally

```powershell
node server.js
```

Then open:

```text
http://localhost:3040
```

### Health check

```text
http://localhost:3040/health
```

### Data storage

By default, the app stores its SQLite database under `./data`.

You can override that path with:

```powershell
$env:DATA_DIR="C:\path\to\data"
node server.js
```

## Deploying

The repo includes a `Dockerfile` and is prepared for platforms like Railway.

Recommended deployment settings:

- mount persistent storage at `/data`
- set `DATA_DIR=/data`

## PowerShell screener

The PowerShell scripts remain in the repo:

- `Get-Mag7Screener.ps1`
- `Measure-Mag7ReportAccuracy.ps1`
- `Register-Mag7DailyTask.ps1`

Run the screener once:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Get-Mag7Screener.ps1
```
