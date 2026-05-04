param(
    [string]$TaskName = 'Mag7DailyScreener',
    [string]$ScriptPath = "$PSScriptRoot\Get-Mag7Screener.ps1",
    [string]$OutputDir = "$PSScriptRoot\output",
    [switch]$EmailReport,
    [string]$To = $env:MAG7_EMAIL_TO
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ScriptPath)) {
    throw "Could not find screener script at $ScriptPath"
}

$escapedScript = $ScriptPath.Replace('"', '""')
$escapedOutput = $OutputDir.Replace('"', '""')
$emailFlag = if ($EmailReport) { '-EmailReport' } else { '' }
$toFlag = if ($To) { "-To `"$($To.Replace('"','""'))`"" } else { '' }
$argument = "-NoProfile -ExecutionPolicy Bypass -File `"$escapedScript`" -OutputDir `"$escapedOutput`" $emailFlag $toFlag"

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 11:00AM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Runs the Mag 7 stock trend screener daily at 11:00 AM local time.' -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName'."
Write-Host "It will run on weekdays at 11:00 AM on this machine's local time."
if ($EmailReport -and $To) {
    Write-Host "Daily email recipient: $To"
}
