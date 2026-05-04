# Web Dashboard

This is the Node.js stock monitoring website.

## Features

- multiple stock widgets on one page
- drag-and-drop widget reordering
- global time range selection
- per-widget local time range selection
- SQLite-backed saved symbol list and widget order
- Yahoo Finance-backed historical chart data

## Run locally

```powershell
node server.js
```

Then open:

```text
http://localhost:3040
```

## Health check

```text
http://localhost:3040/health
```

## Data storage

By default, the app stores its SQLite database under `./data`.

You can override that path with:

```powershell
$env:DATA_DIR="C:\path\to\data"
node server.js
```

## Deploying

The project includes a `Dockerfile` and is prepared for platforms like Railway.

Recommended deployment settings:

- service root: `web-dashboard`
- mount persistent storage at `/data`
- set `DATA_DIR=/data`

If Railway is deploying from the repository root, explicitly point the service at the `web-dashboard/` directory.
