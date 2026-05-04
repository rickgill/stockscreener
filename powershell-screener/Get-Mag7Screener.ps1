param(
    [string]$OutputDir = "$PSScriptRoot\output",
    [switch]$EmailReport,
    [string]$SmtpServer = $env:MAG7_SMTP_SERVER,
    [int]$SmtpPort = $(if ($env:MAG7_SMTP_PORT) { [int]$env:MAG7_SMTP_PORT } else { 587 }),
    [string]$SmtpUsername = $env:MAG7_SMTP_USERNAME,
    [string]$SmtpPassword = $env:MAG7_SMTP_PASSWORD,
    [string]$From = $env:MAG7_EMAIL_FROM,
    [string]$To = $env:MAG7_EMAIL_TO,
    [switch]$UseSsl = $(if ($env:MAG7_SMTP_SSL) { [bool]::Parse($env:MAG7_SMTP_SSL) } else { $true })
)

$ErrorActionPreference = 'Stop'

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
    # Ignore on hosts where this setting is unavailable.
}

$tickers = @('AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'NVDA', 'TSLA')

function Test-TradingDay {
    param(
        [datetime]$Date = (Get-Date)
    )

    return ($Date.DayOfWeek -ne [System.DayOfWeek]::Saturday -and $Date.DayOfWeek -ne [System.DayOfWeek]::Sunday)
}

function Get-ChartData {
    param(
        [Parameter(Mandatory)]
        [string]$Ticker,
        [string]$Range = '3mo',
        [string]$Interval = '1d'
    )

    $url = "https://query1.finance.yahoo.com/v8/finance/chart/${Ticker}?range=$Range&interval=$Interval&includePrePost=false&events=div%2Csplits"
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -Headers @{ 'User-Agent' = 'Mozilla/5.0' }
    $payload = $response.Content | ConvertFrom-Json
    $result = $payload.chart.result[0]

    if (-not $result -or -not $result.timestamp) {
        throw "No chart data returned for $Ticker."
    }

    $quote = $result.indicators.quote[0]
    $rows = @()

    for ($i = 0; $i -lt $result.timestamp.Count; $i++) {
        $close = $quote.close[$i]
        if ($null -eq $close) {
            continue
        }

        $rows += [pscustomobject]@{
            Date   = [DateTimeOffset]::FromUnixTimeSeconds([int64]$result.timestamp[$i]).LocalDateTime
            Open   = [double]$quote.open[$i]
            High   = [double]$quote.high[$i]
            Low    = [double]$quote.low[$i]
            Close  = [double]$close
            Volume = [double]$quote.volume[$i]
        }
    }

    return $rows
}

function Get-Sma {
    param(
        [double[]]$Values,
        [int]$Period,
        [int]$EndIndex = ($Values.Count - 1)
    )

    if ($EndIndex -lt ($Period - 1)) {
        return $null
    }

    $sum = 0.0
    for ($i = $EndIndex - $Period + 1; $i -le $EndIndex; $i++) {
        $sum += $Values[$i]
    }
    return $sum / $Period
}

function Get-StdDev {
    param(
        [double[]]$Values,
        [int]$Period,
        [int]$EndIndex = ($Values.Count - 1)
    )

    $sma = Get-Sma -Values $Values -Period $Period -EndIndex $EndIndex
    if ($null -eq $sma) {
        return $null
    }

    $sum = 0.0
    for ($i = $EndIndex - $Period + 1; $i -le $EndIndex; $i++) {
        $delta = $Values[$i] - $sma
        $sum += ($delta * $delta)
    }
    return [Math]::Sqrt($sum / $Period)
}

function Get-EmaSeries {
    param(
        [double[]]$Values,
        [int]$Period
    )

    if ($Values.Count -lt $Period) {
        return @()
    }

    $multiplier = 2.0 / ($Period + 1)
    $ema = New-Object 'System.Collections.Generic.List[double]'
    $seed = Get-Sma -Values $Values -Period $Period -EndIndex ($Period - 1)
    for ($i = 0; $i -lt $Period - 1; $i++) {
        $ema.Add([double]::NaN)
    }
    $ema.Add($seed)

    for ($i = $Period; $i -lt $Values.Count; $i++) {
        $next = (($Values[$i] - $ema[$i - 1]) * $multiplier) + $ema[$i - 1]
        $ema.Add($next)
    }

    return $ema.ToArray()
}

function Get-RsiSeries {
    param(
        [double[]]$Values,
        [int]$Period = 14
    )

    if ($Values.Count -le $Period) {
        return @()
    }

    $rsi = New-Object 'System.Collections.Generic.List[double]'
    $gains = 0.0
    $losses = 0.0

    $rsi.Add([double]::NaN)
    for ($i = 1; $i -le $Period; $i++) {
        $change = $Values[$i] - $Values[$i - 1]
        if ($change -ge 0) {
            $gains += $change
        } else {
            $losses += -1 * $change
        }
        $rsi.Add([double]::NaN)
    }

    $avgGain = $gains / $Period
    $avgLoss = $losses / $Period
    $firstRsi = if ($avgLoss -eq 0) { 100.0 } else { 100 - (100 / (1 + ($avgGain / $avgLoss))) }
    $rsi[$Period] = $firstRsi

    for ($i = $Period + 1; $i -lt $Values.Count; $i++) {
        $change = $Values[$i] - $Values[$i - 1]
        $gain = if ($change -gt 0) { $change } else { 0.0 }
        $loss = if ($change -lt 0) { -1 * $change } else { 0.0 }
        $avgGain = (($avgGain * ($Period - 1)) + $gain) / $Period
        $avgLoss = (($avgLoss * ($Period - 1)) + $loss) / $Period
        $nextRsi = if ($avgLoss -eq 0) { 100.0 } else { 100 - (100 / (1 + ($avgGain / $avgLoss))) }
        $rsi.Add($nextRsi)
    }

    return $rsi.ToArray()
}

function Get-AtrSeries {
    param(
        [object[]]$Rows,
        [int]$Period = 14
    )

    if ($Rows.Count -le $Period) {
        return @()
    }

    $trs = New-Object 'System.Collections.Generic.List[double]'
    $trs.Add([double]::NaN)
    for ($i = 1; $i -lt $Rows.Count; $i++) {
        $highLow = $Rows[$i].High - $Rows[$i].Low
        $highPrevClose = [Math]::Abs($Rows[$i].High - $Rows[$i - 1].Close)
        $lowPrevClose = [Math]::Abs($Rows[$i].Low - $Rows[$i - 1].Close)
        $trs.Add(([Math]::Max($highLow, [Math]::Max($highPrevClose, $lowPrevClose))))
    }

    $atr = New-Object 'System.Collections.Generic.List[double]'
    for ($i = 0; $i -lt $Period; $i++) {
        $atr.Add([double]::NaN)
    }

    $seed = 0.0
    for ($i = 1; $i -le $Period; $i++) {
        $seed += $trs[$i]
    }
    $currentAtr = $seed / $Period
    $atr.Add($currentAtr)

    for ($i = $Period + 1; $i -lt $Rows.Count; $i++) {
        $currentAtr = (($currentAtr * ($Period - 1)) + $trs[$i]) / $Period
        $atr.Add($currentAtr)
    }

    return $atr.ToArray()
}

function Get-LinearSlope {
    param(
        [double[]]$Values,
        [int]$Period
    )

    if ($Values.Count -lt $Period) {
        return $null
    }

    $start = $Values.Count - $Period
    $sumX = 0.0
    $sumY = 0.0
    $sumXY = 0.0
    $sumX2 = 0.0

    for ($i = 0; $i -lt $Period; $i++) {
        $x = [double]$i
        $y = $Values[$start + $i]
        $sumX += $x
        $sumY += $y
        $sumXY += ($x * $y)
        $sumX2 += ($x * $x)
    }

    $denominator = ($Period * $sumX2) - ($sumX * $sumX)
    if ($denominator -eq 0) {
        return $null
    }

    return (($Period * $sumXY) - ($sumX * $sumY)) / $denominator
}

function Get-RelativeStrengthPct {
    param(
        [double[]]$AssetValues,
        [double[]]$BenchmarkValues,
        [int]$Period
    )

    if ($AssetValues.Count -lt $Period -or $BenchmarkValues.Count -lt $Period) {
        return $null
    }

    $assetReturn = ($AssetValues[-1] / $AssetValues[-$Period]) - 1
    $benchmarkReturn = ($BenchmarkValues[-1] / $BenchmarkValues[-$Period]) - 1
    return ($assetReturn - $benchmarkReturn) * 100
}

function Get-HorizonLabel {
    param(
        [int]$Score,
        [int]$StrongThreshold,
        [int]$WeakThreshold
    )

    if ($Score -ge $StrongThreshold) {
        return 'UPWARDS'
    }
    if ($Score -le (-1 * $StrongThreshold)) {
        return 'DOWNWARDS'
    }
    if ($Score -ge $WeakThreshold) {
        return 'SLIGHT_UP'
    }
    if ($Score -le (-1 * $WeakThreshold)) {
        return 'SLIGHT_DOWN'
    }
    return 'NEUTRAL'
}

function Get-Recommendation {
    param(
        [object[]]$DailyRows,
        [object[]]$HourlyRows,
        [object[]]$BenchmarkDailyRows,
        [object[]]$BenchmarkHourlyRows,
        [string]$Ticker
    )

    if ($DailyRows.Count -lt 40) {
        throw "Insufficient daily history returned for $Ticker."
    }
    if ($HourlyRows.Count -lt 24) {
        throw "Insufficient hourly history returned for $Ticker."
    }
    if ($BenchmarkDailyRows.Count -lt 40) {
        throw 'Insufficient benchmark daily history returned for QQQ.'
    }
    if ($BenchmarkHourlyRows.Count -lt 24) {
        throw 'Insufficient benchmark hourly history returned for QQQ.'
    }

    $closes = @($DailyRows | ForEach-Object { [double]$_.Close })
    $volumes = @($DailyRows | ForEach-Object { [double]$_.Volume })
    $benchmarkCloses = @($BenchmarkDailyRows | ForEach-Object { [double]$_.Close })
    $latest = $DailyRows[-1]
    $previous = $DailyRows[-2]

    $sma20 = Get-Sma -Values $closes -Period 20
    $sma50 = Get-Sma -Values $closes -Period 50
    $ema12Series = Get-EmaSeries -Values $closes -Period 12
    $ema26Series = Get-EmaSeries -Values $closes -Period 26
    $macdLine = @()
    for ($i = 0; $i -lt $closes.Count; $i++) {
        if ([double]::IsNaN($ema12Series[$i]) -or [double]::IsNaN($ema26Series[$i])) {
            $macdLine += [double]::NaN
        } else {
            $macdLine += ($ema12Series[$i] - $ema26Series[$i])
        }
    }

    $validMacd = @($macdLine | Where-Object { -not [double]::IsNaN($_) })
    $signalSeed = Get-EmaSeries -Values $validMacd -Period 9
    $signalLine = New-Object 'System.Collections.Generic.List[double]'
    $validIndex = 0
    for ($i = 0; $i -lt $macdLine.Count; $i++) {
        if ([double]::IsNaN($macdLine[$i])) {
            $signalLine.Add([double]::NaN)
        } else {
            $signalLine.Add($signalSeed[$validIndex])
            $validIndex++
        }
    }

    $rsiSeries = Get-RsiSeries -Values $closes -Period 14
    $atrSeries = Get-AtrSeries -Rows $DailyRows -Period 14
    $std20 = Get-StdDev -Values $closes -Period 20
    $bollingerUpper = $sma20 + (2 * $std20)
    $bollingerLower = $sma20 - (2 * $std20)
    $volume20 = Get-Sma -Values $volumes -Period 20
    $highest20 = ($DailyRows | Select-Object -Last 20 | Measure-Object -Property High -Maximum).Maximum
    $lowest20 = ($DailyRows | Select-Object -Last 20 | Measure-Object -Property Low -Minimum).Minimum
    $return63 = (($latest.Close / $DailyRows[0].Close) - 1) * 100
    $slope20 = Get-LinearSlope -Values $closes -Period 20
    $relativeStrength20 = Get-RelativeStrengthPct -AssetValues $closes -BenchmarkValues $benchmarkCloses -Period 20
    $relativeStrength10 = Get-RelativeStrengthPct -AssetValues $closes -BenchmarkValues $benchmarkCloses -Period 10
    $benchmarkSma20 = Get-Sma -Values $benchmarkCloses -Period 20
    $benchmarkSma50 = Get-Sma -Values $benchmarkCloses -Period 50
    $benchmarkSlope20 = Get-LinearSlope -Values $benchmarkCloses -Period 20

    $macdLatest = $macdLine[-1]
    $signalLatest = $signalLine[-1]
    $histogram = if ([double]::IsNaN($macdLatest) -or [double]::IsNaN($signalLatest)) { 0.0 } else { $macdLatest - $signalLatest }
    $rsiLatest = $rsiSeries[-1]
    $atrLatest = $atrSeries[-1]
    $benchmarkBullish = ($benchmarkCloses[-1] -gt $benchmarkSma20) -and ($benchmarkSma20 -gt $benchmarkSma50) -and ($benchmarkSlope20 -gt 0)
    $benchmarkBearish = ($benchmarkCloses[-1] -lt $benchmarkSma20) -and ($benchmarkSma20 -lt $benchmarkSma50) -and ($benchmarkSlope20 -lt 0)

    $dailySignals = New-Object 'System.Collections.Generic.List[string]'
    $dailyBullPoints = 0
    $dailyBearPoints = 0

    if ($benchmarkBullish) { $dailyBullPoints += 2; $dailySignals.Add('QQQ confirms bullish market regime') }
    elseif ($benchmarkBearish) { $dailyBearPoints += 2; $dailySignals.Add('QQQ confirms bearish market regime') }
    else { $dailySignals.Add('QQQ regime mixed') }

    if ($latest.Close -gt $sma20) { $dailyBullPoints += 1; $dailySignals.Add('Price above 20-day SMA') } else { $dailyBearPoints += 1; $dailySignals.Add('Price below 20-day SMA') }
    if ($sma20 -gt $sma50) { $dailyBullPoints += 2; $dailySignals.Add('20-day SMA above 50-day SMA') } else { $dailyBearPoints += 2; $dailySignals.Add('20-day SMA below 50-day SMA') }
    if ($histogram -gt 0 -and $macdLatest -gt $signalLatest) { $dailyBullPoints += 2; $dailySignals.Add('MACD confirms upside momentum') }
    elseif ($histogram -lt 0 -and $macdLatest -lt $signalLatest) { $dailyBearPoints += 2; $dailySignals.Add('MACD confirms downside momentum') }
    if ($rsiLatest -ge 52 -and $rsiLatest -le 68) { $dailyBullPoints += 1; $dailySignals.Add('RSI in controlled bullish zone') }
    elseif ($rsiLatest -le 48 -and $rsiLatest -ge 32) { $dailyBearPoints += 1; $dailySignals.Add('RSI in controlled bearish zone') }
    elseif ($rsiLatest -gt 72) { $dailySignals.Add('RSI overbought, trend continuation risk is less reliable') }
    elseif ($rsiLatest -lt 28) { $dailySignals.Add('RSI oversold, downside continuation risk is less reliable') }
    if ($latest.Volume -gt ($volume20 * 1.05)) { $dailyBullPoints += 1; $dailySignals.Add('Volume slightly above 20-day average') }
    elseif ($latest.Volume -lt ($volume20 * 0.75)) { $dailySignals.Add('Volume too light for conviction') }
    if ($latest.Close -ge ($highest20 * 0.998)) { $dailyBullPoints += 1; $dailySignals.Add('Near 20-day breakout zone') }
    if ($latest.Close -le ($lowest20 * 1.002)) { $dailyBearPoints += 1; $dailySignals.Add('Near 20-day breakdown zone') }
    if ($slope20 -gt 0) { $dailyBullPoints += 2; $dailySignals.Add('Positive 20-day slope') } else { $dailyBearPoints += 2; $dailySignals.Add('Negative 20-day slope') }
    if ($relativeStrength20 -gt 1.5 -and $relativeStrength10 -gt 0.5) { $dailyBullPoints += 2; $dailySignals.Add('Outperforming QQQ on 10-day and 20-day basis') }
    elseif ($relativeStrength20 -lt -1.5 -and $relativeStrength10 -lt -0.5) { $dailyBearPoints += 2; $dailySignals.Add('Underperforming QQQ on 10-day and 20-day basis') }
    else { $dailySignals.Add('Relative strength vs QQQ is mixed') }
    if ($return63 -gt 10) { $dailyBullPoints += 1; $dailySignals.Add('Strong 3-month return trend') }
    elseif ($return63 -lt -10) { $dailyBearPoints += 1; $dailySignals.Add('Weak 3-month return trend') }
    if ($latest.Close -gt $bollingerUpper) { $dailySignals.Add('Above upper Bollinger band, risk of mean reversion') }
    elseif ($latest.Close -lt $bollingerLower) { $dailySignals.Add('Below lower Bollinger band, risk of mean reversion') }

    $dailyEdge = $dailyBullPoints - $dailyBearPoints
    $dailyRecommendation = 'NEUTRAL'
    if ($dailyBullPoints -ge 8 -and $dailyBearPoints -le 2 -and $benchmarkBullish -and $rsiLatest -lt 72) {
        $dailyRecommendation = if ($dailyBullPoints -ge 10) { 'UPWARDS' } else { 'SLIGHT_UP' }
    } elseif ($dailyBearPoints -ge 8 -and $dailyBullPoints -le 2 -and $benchmarkBearish -and $rsiLatest -gt 28) {
        $dailyRecommendation = if ($dailyBearPoints -ge 10) { 'DOWNWARDS' } else { 'SLIGHT_DOWN' }
    }
    $dailyConfidence = [Math]::Min(([Math]::Abs($dailyEdge) * 10), 100)

    $hourlyCloses = @($HourlyRows | ForEach-Object { [double]$_.Close })
    $hourlyVolumes = @($HourlyRows | ForEach-Object { [double]$_.Volume })
    $benchmarkHourlyCloses = @($BenchmarkHourlyRows | ForEach-Object { [double]$_.Close })
    $hourlyLatest = $HourlyRows[-1]
    $hourlySma8 = Get-Sma -Values $hourlyCloses -Period 8
    $hourlySma20 = Get-Sma -Values $hourlyCloses -Period 20
    $hourlyRsiSeries = Get-RsiSeries -Values $hourlyCloses -Period 14
    $hourlyRsi = $hourlyRsiSeries[-1]
    $hourlySlope8 = Get-LinearSlope -Values $hourlyCloses -Period 8
    $hourlyEma5 = Get-EmaSeries -Values $hourlyCloses -Period 5
    $hourlyEma13 = Get-EmaSeries -Values $hourlyCloses -Period 13
    $hourlyMacd = $hourlyEma5[-1] - $hourlyEma13[-1]
    $hourlyVolume8 = Get-Sma -Values $hourlyVolumes -Period 8
    $hourlyReturn4 = (($hourlyLatest.Close / $HourlyRows[-5].Close) - 1) * 100
    $hourlyGapFromDaily = (($hourlyLatest.Close / $latest.Close) - 1) * 100
    $benchmarkHourlySma8 = Get-Sma -Values $benchmarkHourlyCloses -Period 8
    $benchmarkHourlySma20 = Get-Sma -Values $benchmarkHourlyCloses -Period 20
    $benchmarkHourlySlope8 = Get-LinearSlope -Values $benchmarkHourlyCloses -Period 8
    $hourlyRelativeStrength8 = Get-RelativeStrengthPct -AssetValues $hourlyCloses -BenchmarkValues $benchmarkHourlyCloses -Period 8
    $hourlyBullPoints = 0
    $hourlyBearPoints = 0
    $hourlySignals = New-Object 'System.Collections.Generic.List[string]'

    $benchmarkHourlyBullish = ($benchmarkHourlyCloses[-1] -gt $benchmarkHourlySma8) -and ($benchmarkHourlySma8 -gt $benchmarkHourlySma20) -and ($benchmarkHourlySlope8 -gt 0)
    $benchmarkHourlyBearish = ($benchmarkHourlyCloses[-1] -lt $benchmarkHourlySma8) -and ($benchmarkHourlySma8 -lt $benchmarkHourlySma20) -and ($benchmarkHourlySlope8 -lt 0)

    if ($benchmarkHourlyBullish) { $hourlyBullPoints += 2; $hourlySignals.Add('QQQ intraday regime bullish') }
    elseif ($benchmarkHourlyBearish) { $hourlyBearPoints += 2; $hourlySignals.Add('QQQ intraday regime bearish') }
    else { $hourlySignals.Add('QQQ intraday regime mixed') }
    if ($hourlyLatest.Close -gt $hourlySma8) { $hourlyBullPoints += 1; $hourlySignals.Add('Price above 8-hour SMA') } else { $hourlyBearPoints += 1; $hourlySignals.Add('Price below 8-hour SMA') }
    if ($hourlySma8 -gt $hourlySma20) { $hourlyBullPoints += 2; $hourlySignals.Add('8-hour SMA above 20-hour SMA') } else { $hourlyBearPoints += 2; $hourlySignals.Add('8-hour SMA below 20-hour SMA') }
    if ($hourlyMacd -gt 0) { $hourlyBullPoints += 2; $hourlySignals.Add('Hourly MACD positive') } else { $hourlyBearPoints += 2; $hourlySignals.Add('Hourly MACD negative') }
    if ($hourlyRsi -ge 54 -and $hourlyRsi -le 68) { $hourlyBullPoints += 1; $hourlySignals.Add('Hourly RSI supports continuation') }
    elseif ($hourlyRsi -le 46 -and $hourlyRsi -ge 32) { $hourlyBearPoints += 1; $hourlySignals.Add('Hourly RSI supports weakness') }
    else { $hourlySignals.Add('Hourly RSI is stretched or mixed') }
    if ($hourlySlope8 -gt 0) { $hourlyBullPoints += 2; $hourlySignals.Add('Positive 8-hour slope') } else { $hourlyBearPoints += 2; $hourlySignals.Add('Negative 8-hour slope') }
    if ($hourlyLatest.Volume -gt ($hourlyVolume8 * 1.15)) { $hourlyBullPoints += 1; $hourlySignals.Add('Recent hourly volume elevated') }
    elseif ($hourlyLatest.Volume -lt ($hourlyVolume8 * 0.8)) { $hourlySignals.Add('Recent hourly volume too light for conviction') }
    if ($hourlyReturn4 -gt 0.6) { $hourlyBullPoints += 1; $hourlySignals.Add('Positive last 4-hour move') }
    elseif ($hourlyReturn4 -lt -0.6) { $hourlyBearPoints += 1; $hourlySignals.Add('Negative last 4-hour move') }
    if ($hourlyGapFromDaily -gt 0.5) { $hourlyBullPoints += 1; $hourlySignals.Add('Trading above daily reference level') }
    elseif ($hourlyGapFromDaily -lt -0.5) { $hourlyBearPoints += 1; $hourlySignals.Add('Trading below daily reference level') }
    if ($hourlyRelativeStrength8 -gt 0.35) { $hourlyBullPoints += 1; $hourlySignals.Add('Outperforming QQQ intraday') }
    elseif ($hourlyRelativeStrength8 -lt -0.35) { $hourlyBearPoints += 1; $hourlySignals.Add('Underperforming QQQ intraday') }

    $hourlyEdge = $hourlyBullPoints - $hourlyBearPoints
    $hourlyRecommendation = 'NEUTRAL'
    if ($hourlyBullPoints -ge 7 -and $hourlyBearPoints -le 1 -and $benchmarkHourlyBullish -and $dailyRecommendation -ne 'DOWNWARDS' -and $hourlyRsi -lt 72) {
        $hourlyRecommendation = if ($hourlyBullPoints -ge 9) { 'UPWARDS' } else { 'SLIGHT_UP' }
    } elseif ($hourlyBearPoints -ge 7 -and $hourlyBullPoints -le 1 -and $benchmarkHourlyBearish -and $dailyRecommendation -ne 'UPWARDS' -and $hourlyRsi -gt 30) {
        $hourlyRecommendation = if ($hourlyBearPoints -ge 9) { 'DOWNWARDS' } else { 'SLIGHT_DOWN' }
    }
    $hourlyConfidence = [Math]::Min(([Math]::Abs($hourlyEdge) * 10), 100)

    return [pscustomobject]@{
        Ticker                    = $Ticker
        NextFewHours              = $hourlyRecommendation
        NextFewHoursScore         = $hourlyEdge
        NextFewHoursConfidencePct = $hourlyConfidence
        NextTradingDay            = $dailyRecommendation
        NextTradingDayScore       = $dailyEdge
        NextTradingDayConfidencePct = $dailyConfidence
        LastClose                 = [Math]::Round($latest.Close, 2)
        DailyChangePct            = [Math]::Round((($latest.Close / $previous.Close) - 1) * 100, 2)
        Return3MPct               = [Math]::Round($return63, 2)
        RSI14                     = [Math]::Round($rsiLatest, 2)
        SMA20                     = [Math]::Round($sma20, 2)
        SMA50                     = [Math]::Round($sma50, 2)
        MACDHistogram             = [Math]::Round($histogram, 4)
        ATR14                     = [Math]::Round($atrLatest, 2)
        VolumeVs20Day             = [Math]::Round(($latest.Volume / $volume20), 2)
        HourlyMove4HPct           = [Math]::Round($hourlyReturn4, 2)
        HourlyRSI14               = [Math]::Round($hourlyRsi, 2)
        HourlySMA8                = [Math]::Round($hourlySma8, 2)
        HourlySMA20               = [Math]::Round($hourlySma20, 2)
        HourlyMACD                = [Math]::Round($hourlyMacd, 4)
        HourlyVsDailyClosePct     = [Math]::Round($hourlyGapFromDaily, 2)
        RelativeStrength20Pct     = [Math]::Round($relativeStrength20, 2)
        RelativeStrength10Pct     = [Math]::Round($relativeStrength10, 2)
        HourlyRelativeStrength8Pct = [Math]::Round($hourlyRelativeStrength8, 2)
        DailySignals              = ($dailySignals | Select-Object -Unique)
        HourlySignals             = ($hourlySignals | Select-Object -Unique)
        AsOf                      = $latest.Date
    }
}

function ConvertTo-ReportText {
    param(
        [object[]]$Results
    )

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $lines.Add("Mag 7 trend screener")
    $lines.Add("Generated: $timestamp")
    $lines.Add("")

    foreach ($result in ($Results | Sort-Object NextTradingDayScore -Descending)) {
        $lines.Add(("{0}: Next few hours {1} ({2}/{3}%) | Next trading day {4} ({5}/{6}%)" -f
            $result.Ticker,
            $result.NextFewHours,
            $result.NextFewHoursScore,
            $result.NextFewHoursConfidencePct,
            $result.NextTradingDay,
            $result.NextTradingDayScore,
            $result.NextTradingDayConfidencePct))
        $lines.Add(("Daily view: Close {0} | 1D {1}% | 3M {2}% | RSI {3} | SMA20 {4} | SMA50 {5} | MACD Hist {6} | ATR {7} | Vol x{8}" -f
            $result.LastClose,
            $result.DailyChangePct,
            $result.Return3MPct,
            $result.RSI14,
            $result.SMA20,
            $result.SMA50,
            $result.MACDHistogram,
            $result.ATR14,
            $result.VolumeVs20Day))
        $lines.Add(("Relative strength: 20D {0}% | 10D {1}% | Hourly 8-bar {2}%" -f
            $result.RelativeStrength20Pct,
            $result.RelativeStrength10Pct,
            $result.HourlyRelativeStrength8Pct))
        $lines.Add(("Hourly view: 4H {0}% | RSI {1} | SMA8 {2} | SMA20 {3} | MACD {4} | Vs daily close {5}%" -f
            $result.HourlyMove4HPct,
            $result.HourlyRSI14,
            $result.HourlySMA8,
            $result.HourlySMA20,
            $result.HourlyMACD,
            $result.HourlyVsDailyClosePct))
        $lines.Add(("Daily signals: {0}" -f ($result.DailySignals -join '; ')))
        $lines.Add(("Hourly signals: {0}" -f ($result.HourlySignals -join '; ')))
        $lines.Add("")
    }

    return ($lines -join [Environment]::NewLine)
}

function Send-EmailReport {
    param(
        [string]$Body
    )

    if (-not $To) {
        throw 'Email delivery requested, but no recipient was provided. Set MAG7_EMAIL_TO or pass -To.'
    }

    if ($SmtpServer -and $SmtpUsername -and $SmtpPassword -and $From) {
        $message = New-Object System.Net.Mail.MailMessage
        $message.From = $From
        $message.To.Add($To)
        $message.Subject = "Mag 7 trend screener - $(Get-Date -Format 'yyyy-MM-dd')"
        $message.Body = $Body

        $smtp = New-Object System.Net.Mail.SmtpClient($SmtpServer, $SmtpPort)
        $smtp.EnableSsl = $UseSsl
        $smtp.Credentials = New-Object System.Net.NetworkCredential($SmtpUsername, $SmtpPassword)
        $smtp.Send($message)
        return 'SMTP'
    }

    try {
        $outlook = New-Object -ComObject Outlook.Application
        $mail = $outlook.CreateItem(0)
        $mail.To = $To
        if ($From) {
            $mail.SentOnBehalfOfName = $From
        }
        $mail.Subject = "Mag 7 trend screener - $(Get-Date -Format 'yyyy-MM-dd')"
        $mail.Body = $Body
        $mail.Send()
        return 'Outlook'
    } catch {
        throw "Email delivery failed. SMTP is not fully configured and Outlook send failed: $($_.Exception.Message)"
    }
}

if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$now = Get-Date
if (-not (Test-TradingDay -Date $now)) {
    $message = "Mag 7 trend screener skipped on $($now.ToString('yyyy-MM-dd')) because the U.S. market is closed on weekends."
    Write-Host $message
    if ($EmailReport -and $To) {
        $deliveryMethod = Send-EmailReport -Body $message
        Write-Host "Skip notice sent to $To via $deliveryMethod"
    }
    exit 0
}

$benchmarkDailyRows = Get-ChartData -Ticker 'QQQ' -Range '3mo' -Interval '1d'
$benchmarkHourlyRows = Get-ChartData -Ticker 'QQQ' -Range '1mo' -Interval '1h'

$results = foreach ($ticker in $tickers) {
    try {
        $dailyRows = Get-ChartData -Ticker $ticker -Range '3mo' -Interval '1d'
        $hourlyRows = Get-ChartData -Ticker $ticker -Range '1mo' -Interval '1h'
        Get-Recommendation -DailyRows $dailyRows -HourlyRows $hourlyRows -BenchmarkDailyRows $benchmarkDailyRows -BenchmarkHourlyRows $benchmarkHourlyRows -Ticker $ticker
    } catch {
        [pscustomobject]@{
            Ticker                    = $ticker
            NextFewHours              = 'ERROR'
            NextFewHoursScore         = -999
            NextFewHoursConfidencePct = 0
            NextTradingDay            = 'ERROR'
            NextTradingDayScore       = -999
            NextTradingDayConfidencePct = 0
            LastClose                 = $null
            DailyChangePct            = $null
            Return3MPct               = $null
            RSI14                     = $null
            SMA20                     = $null
            SMA50                     = $null
            MACDHistogram             = $null
            ATR14                     = $null
            VolumeVs20Day             = $null
            HourlyMove4HPct           = $null
            HourlyRSI14               = $null
            HourlySMA8                = $null
            HourlySMA20               = $null
            HourlyMACD                = $null
            HourlyVsDailyClosePct     = $null
            RelativeStrength20Pct     = $null
            RelativeStrength10Pct     = $null
            HourlyRelativeStrength8Pct = $null
            DailySignals              = @($_.Exception.Message)
            HourlySignals             = @($_.Exception.Message)
            AsOf                      = Get-Date
        }
    }
}

$report = ConvertTo-ReportText -Results $results
$dateStamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$txtPath = Join-Path $OutputDir "mag7_report_$dateStamp.txt"
$csvPath = Join-Path $OutputDir "mag7_report_$dateStamp.csv"

$report | Set-Content -LiteralPath $txtPath
$results | Export-Csv -LiteralPath $csvPath -NoTypeInformation

Write-Host $report
Write-Host "Saved text report to $txtPath"
Write-Host "Saved CSV report to $csvPath"

if ($EmailReport) {
    $deliveryMethod = Send-EmailReport -Body $report
    Write-Host "Email report sent to $To via $deliveryMethod"
}
