# Stock Screener Projects

This repository now contains two separate projects:

- [web-dashboard](./web-dashboard): a Node.js stock monitoring website with draggable widgets, local/global range selection, and SQLite-backed persistence
- [powershell-screener](./powershell-screener): a PowerShell-based Magnificent 7 stock screener and reporting tool

## Repo layout

```text
web-dashboard/
powershell-screener/
BUILD_FROM_SCRATCH.md
USAGE_GUIDE.md
WORK_DONE.md
```

## Documentation

- [BUILD_FROM_SCRATCH.md](./BUILD_FROM_SCRATCH.md): architecture, implementation details, backend/frontend design, deployment model, and rebuild sequence
- [USAGE_GUIDE.md](./USAGE_GUIDE.md): operator-focused guide for watchlists, dashboard workflows, screener usage, backtests, and signal pages
- [WORK_DONE.md](./WORK_DONE.md): historical summary of major project milestones

## Which project to use

Use `web-dashboard` if you want:

- an interactive website
- live widget-based stock monitoring
- browser UI with saved symbols and order

Use `powershell-screener` if you want:

- a scriptable rules-based screener
- report generation
- scheduled PowerShell execution

## Notes

- the website project is prepared for deployment separately
- the PowerShell project remains self-contained and script-driven

## Railway deployment note

If you deploy this repository to Railway, use:

- service root: `web-dashboard`
- volume mount path: `/data`
- environment variable: `DATA_DIR=/data`
