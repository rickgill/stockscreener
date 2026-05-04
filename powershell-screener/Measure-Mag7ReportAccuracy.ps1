param(
    [string]$OutputDir = "$PSScriptRoot\output",
    [datetime]$StartDate = (Get-Date).AddDays(-7).Date,
    [datetime]$EndDate = (Get-Date).Date
)

$ErrorActionPreference = 'Stop'

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
    # Ignore on hosts where this setting is unavailable.
}

function Get-ChartData {
    param(
        [Parameter(Mandatory)]
        [string]$Ticker,
        [string]$Range,
        [string]$Interval
    )

    $url = "https://query1.finance.yahoo.com/v8/finance/chart/${Ticker}?range=$Range&interval=$Interval&includePrePost=false&events=div%2Csplits"
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -Headers @{ 'User-Agent' = 'Mozilla/5.0' }
    $payload = $response.Content | ConvertFrom-Json
    $result = $payload.chart.result[0]
    $quote = $result.indicators.quote[0]
    $rows = @()

    for ($i = 0; $i -lt $result.timestamp.Count; $i++) {
        $close = $quote.close[$i]
        if ($null -eq $close) {
            continue
        }

        $rows += [pscustomobject]@{
            Date  = [DateTimeOffset]::FromUnixTimeSeconds([int64]$result.timestamp[$i]).LocalDateTime
            Close = [double]$close
        }
    }

    return $rows
}

function Get-DirectionLabel {
    param([string]$Recommendation)

    switch ($Recommendation) {
        'UPWARDS' { 'UP' }
        'SLIGHT_UP' { 'UP' }
        'DOWNWARDS' { 'DOWN' }
        'SLIGHT_DOWN' { 'DOWN' }
        default { 'NEUTRAL' }
    }
}

function Get-ActualLabel {
    param(
        [double]$PctChange,
        [double]$FlatThreshold
    )

    if ($PctChange -gt $FlatThreshold) {
        return 'UP'
    }
    if ($PctChange -lt (-1 * $FlatThreshold)) {
        return 'DOWN'
    }
    return 'NEUTRAL'
}

$files = Get-ChildItem -LiteralPath $OutputDir -Filter 'mag7_report_*.csv' |
    Where-Object { $_.LastWriteTime.Date -ge $StartDate -and $_.LastWriteTime.Date -le $EndDate } |
    Sort-Object LastWriteTime |
    Group-Object { $_.LastWriteTime.ToString('yyyy-MM-dd') } |
    ForEach-Object { $_.Group | Sort-Object LastWriteTime -Descending | Select-Object -First 1 } |
    Sort-Object LastWriteTime

if (-not $files) {
    throw "No report files found in $OutputDir for the requested window."
}

$reports = foreach ($file in $files) {
    $rows = Import-Csv -LiteralPath $file.FullName
    $distinctAsOfDates = @($rows | ForEach-Object { ([datetime]$_.AsOf).Date } | Sort-Object -Unique)

    [pscustomobject]@{
        File             = $file.Name
        ReportDate       = $file.LastWriteTime.Date
        AsOfDate         = $distinctAsOfDates[0]
        IsFreshMarketDay = ($distinctAsOfDates.Count -eq 1 -and $distinctAsOfDates[0] -eq $file.LastWriteTime.Date)
        Rows             = $rows
    }
}

$tickers = @('AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'NVDA', 'TSLA')
$dailyHistory = @{}
$hourlyHistory = @{}

foreach ($ticker in $tickers) {
    $dailyHistory[$ticker] = Get-ChartData -Ticker $ticker -Range '3mo' -Interval '1d'
    $hourlyHistory[$ticker] = Get-ChartData -Ticker $ticker -Range '1mo' -Interval '1h'
}

$nextTradingDayChecks = @()
$nextFewHoursChecks = @()

foreach ($report in ($reports | Where-Object IsFreshMarketDay)) {
    $nextReport = $reports |
        Where-Object { $_.IsFreshMarketDay -and $_.ReportDate -gt $report.ReportDate } |
        Sort-Object ReportDate |
        Select-Object -First 1

    foreach ($row in $report.Rows) {
        $ticker = $row.Ticker

        if ($nextReport) {
            $nextRow = $nextReport.Rows | Where-Object Ticker -eq $ticker | Select-Object -First 1
            $pctChange = (([double]$nextRow.LastClose / [double]$row.LastClose) - 1) * 100
            $prediction = Get-DirectionLabel -Recommendation $row.NextTradingDay
            $actual = Get-ActualLabel -PctChange $pctChange -FlatThreshold 0.35

            $nextTradingDayChecks += [pscustomobject]@{
                ReportDate = $report.ReportDate.ToString('yyyy-MM-dd')
                Ticker     = $ticker
                Prediction = $prediction
                Actual     = $actual
                PctChange  = [Math]::Round($pctChange, 2)
                Correct    = ($prediction -eq $actual)
            }
        }

        $sameDayHourly = @($hourlyHistory[$ticker] | Where-Object { $_.Date.Date -eq $report.ReportDate } | Sort-Object Date)
        if ($sameDayHourly.Count -gt 0) {
            $pctChange = (([double]$sameDayHourly[-1].Close / [double]$row.LastClose) - 1) * 100
            $prediction = Get-DirectionLabel -Recommendation $row.NextFewHours
            $actual = Get-ActualLabel -PctChange $pctChange -FlatThreshold 0.25

            $nextFewHoursChecks += [pscustomobject]@{
                ReportDate = $report.ReportDate.ToString('yyyy-MM-dd')
                Ticker     = $ticker
                Prediction = $prediction
                Actual     = $actual
                PctChange  = [Math]::Round($pctChange, 2)
                Correct    = ($prediction -eq $actual)
            }
        }
    }
}

$nextTradingDayCorrect = @($nextTradingDayChecks | Where-Object Correct).Count
$nextFewHoursCorrect = @($nextFewHoursChecks | Where-Object Correct).Count
$directionalNextTradingDay = @($nextTradingDayChecks | Where-Object { $_.Prediction -ne 'NEUTRAL' -and $_.Actual -ne 'NEUTRAL' })
$directionalNextFewHours = @($nextFewHoursChecks | Where-Object { $_.Prediction -ne 'NEUTRAL' -and $_.Actual -ne 'NEUTRAL' })

Write-Host "Accuracy window: $($StartDate.ToString('yyyy-MM-dd')) to $($EndDate.ToString('yyyy-MM-dd'))"
Write-Host ''
Write-Host 'Raw accuracy'
Write-Host ("NextTradingDay: {0}/{1} = {2}%" -f $nextTradingDayCorrect, $nextTradingDayChecks.Count, $(if ($nextTradingDayChecks.Count) { [Math]::Round(($nextTradingDayCorrect / $nextTradingDayChecks.Count) * 100, 2) } else { 0 }))
Write-Host ("NextFewHours: {0}/{1} = {2}%" -f $nextFewHoursCorrect, $nextFewHoursChecks.Count, $(if ($nextFewHoursChecks.Count) { [Math]::Round(($nextFewHoursCorrect / $nextFewHoursChecks.Count) * 100, 2) } else { 0 }))
Write-Host ''
Write-Host 'Directional-only accuracy'
Write-Host ("NextTradingDay: {0}/{1} = {2}%" -f @($directionalNextTradingDay | Where-Object Correct).Count, $directionalNextTradingDay.Count, $(if ($directionalNextTradingDay.Count) { [Math]::Round((@($directionalNextTradingDay | Where-Object Correct).Count / $directionalNextTradingDay.Count) * 100, 2) } else { 0 }))
Write-Host ("NextFewHours: {0}/{1} = {2}%" -f @($directionalNextFewHours | Where-Object Correct).Count, $directionalNextFewHours.Count, $(if ($directionalNextFewHours.Count) { [Math]::Round((@($directionalNextFewHours | Where-Object Correct).Count / $directionalNextFewHours.Count) * 100, 2) } else { 0 }))
