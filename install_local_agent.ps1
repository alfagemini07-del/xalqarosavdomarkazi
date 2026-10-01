$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentScript = Join-Path $projectRoot "local_agent.py"

if (-not (Test-Path -LiteralPath $agentScript)) {
    throw "local_agent.py topilmadi: $agentScript"
}

$pythonCommand = Get-Command python -ErrorAction Stop
$pythonExe = $pythonCommand.Source
$pythonwExe = Join-Path (Split-Path -Parent $pythonExe) "pythonw.exe"
if (-not (Test-Path -LiteralPath $pythonwExe)) {
    $pythonwExe = $pythonExe
}

Write-Host "1/4 - Lokal agent sozlamalari" -ForegroundColor Cyan
& $pythonExe $agentScript configure
if ($LASTEXITCODE -ne 0) { throw "Konfiguratsiya saqlanmadi" }

Write-Host "2/4 - Printer agent vazifasi" -ForegroundColor Cyan
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$printAction = New-ScheduledTaskAction -Execute $pythonwExe -Argument "`"$agentScript`" serve" -WorkingDirectory $projectRoot
$printTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Days 3650) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "TaroziKiosk Local Print Agent" -Action $printAction -Trigger $printTrigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "3/4 - Har kunlik backup vazifasi" -ForegroundColor Cyan
$backupAction = New-ScheduledTaskAction -Execute $pythonExe -Argument "`"$agentScript`" backup" -WorkingDirectory $projectRoot
$backupTrigger = New-ScheduledTaskTrigger -Daily -At "00:05"
Register-ScheduledTask -TaskName "TaroziKiosk Daily Backup" -Action $backupAction -Trigger $backupTrigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "4/4 - Printer agentini ishga tushirish" -ForegroundColor Cyan
Start-ScheduledTask -TaskName "TaroziKiosk Local Print Agent"

Write-Host "Tayyor." -ForegroundColor Green
Write-Host "Printer agent: har login bo'lganda ishga tushadi."
Write-Host "Backup: har kuni 00:05 da bajariladi."
Write-Host "Qo'lda test: python local_agent.py test-print"
Write-Host "Qo'lda backup: python local_agent.py backup"
