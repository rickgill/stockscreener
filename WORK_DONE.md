# Work Done

This file summarizes the work completed so far on the `stockscreener` project.

## Project separation

The repository was later reorganized into two explicit subprojects:

- `web-dashboard/`
- `powershell-screener/`

This split makes the website and the PowerShell screener independently navigable and deployable.

## Repository setup

- initialized the GitHub repository content from the local `stock-screener` workspace
- added:
  - `server.js`
  - `public/`
  - `package.json`
  - `Dockerfile`
  - `.dockerignore`
  - `.gitignore`
  - PowerShell screener scripts
- pushed the initial application code to GitHub

## Web dashboard

Built a local Node.js stock dashboard with:

- multiple stock widgets on one page
- add/remove symbol support
- draggable widget-style cards
- fixed two-widget-per-row layout on larger screens
- hidden/background local server startup support

## Chart ranges

Added both:

- global time range selection that updates all widgets
- local per-widget time range selection

Supported ranges:

- `1D`
- `15D`
- `1M`
- `3M`
- `6M`
- `1Y`
- `3Y`
- `5Y`
- `10Y`
- `Max`

## UI updates

Adjusted the widget UI to be cleaner and closer to a finance quote dashboard:

- improved card structure
- fixed overlapping `Refresh` and `Remove` buttons
- improved chart/status presentation
- added drag visual states for reordering

## Persistence

Moved symbol persistence from browser-only storage to SQLite.

Implemented:

- saved symbol storage in `data/stock-screener.sqlite`
- saved widget order in SQLite
- load/add/remove symbol APIs
- reorder persistence API

## Backend/API

Added or updated:

- `GET /api/history`
- `GET /api/symbols`
- `POST /api/symbols`
- `DELETE /api/symbols/:symbol`
- `PUT /api/symbols/order`
- `GET /health`

## Deployment prep

Prepared the app for internet hosting, especially Railway:

- added `Dockerfile`
- added `.dockerignore`
- made data storage path configurable with `DATA_DIR`
- added `/health` endpoint for deployment checks
- updated README with local run and deployment guidance

## Networking attempts

Tried multiple approaches for access from other devices:

- bound the app to all interfaces
- tested port `3040`
- tested port `80`
- attempted LAN access validation
- attempted temporary tunnel setup

Result:

- local app works
- LAN/internet access remained blocked by environment/network restrictions outside the app itself

## Current local run mode

Current expected local access:

- `http://localhost:3040`

LAN target if network policy allows it:

- `http://192.168.68.111:3040`

## GitHub

Repo updated at:

- `https://github.com/rickgill/stockscreener`

Initial pushed commit:

- `22d5bfc` - `Add stock dashboard and screener app`
