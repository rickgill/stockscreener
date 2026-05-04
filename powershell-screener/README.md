# PowerShell Screener

This PowerShell screener scans the Magnificent 7 stocks:

- `AAPL`
- `MSFT`
- `AMZN`
- `GOOGL`
- `META`
- `NVDA`
- `TSLA`

It pulls the last 3 months of daily price data plus recent hourly data from Yahoo Finance, evaluates a stricter ruleset with a `QQQ` market-regime filter and relative-strength checks, and produces two recommendation horizons:

- `NextFewHours`
- `NextTradingDay`

## Files

- `Get-Mag7Screener.ps1`
- `Measure-Mag7ReportAccuracy.ps1`
- `Register-Mag7DailyTask.ps1`

## Run once

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Get-Mag7Screener.ps1
```

## Email delivery

Set these environment variables before running with `-EmailReport`:

```powershell
$env:MAG7_SMTP_SERVER="smtp.example.com"
$env:MAG7_SMTP_PORT="587"
$env:MAG7_SMTP_USERNAME="user@example.com"
$env:MAG7_SMTP_PASSWORD="app-password"
$env:MAG7_SMTP_SSL="true"
$env:MAG7_EMAIL_FROM="user@example.com"
$env:MAG7_EMAIL_TO="your-address@example.com"
```

Then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Get-Mag7Screener.ps1 -EmailReport
```

## Daily scheduling

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Register-Mag7DailyTask.ps1
```
