# Stock Screener Projects

This repository now contains two separate projects:

- [web-dashboard](./web-dashboard): a Node.js stock monitoring website with draggable widgets, local/global range selection, and SQLite-backed persistence
- [powershell-screener](./powershell-screener): a PowerShell-based Magnificent 7 stock screener and reporting tool

## Repo layout

```text
web-dashboard/
powershell-screener/
WORK_DONE.md
```

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
