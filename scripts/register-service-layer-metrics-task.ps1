<#
  Registra la Tarea Programada de Windows del job diario de
  "Métricas Service Layer" (OLP) en pce0023.

  Corre TODOS LOS DÍAS a la 01:00 am: a esa hora el log del día anterior en
  serfarma07 ya cerró (SAP Service Layer deja de escribirle pasada la
  medianoche), así que el conteo del día "ayer" queda estable -- ver nota en
  scripts/service-layer-metrics-daily-job.ts.

  Re-ejecutar este script es seguro: usa -Force, así que actualiza la tarea
  si ya existe en vez de duplicarla.

  Uso (elevar PowerShell como administrador si hace falta permiso para
  registrar tareas del sistema):
    powershell -File scripts\register-service-layer-metrics-task.ps1
#>

$TaskName = 'SynerLink-ServiceLayerMetrics-Daily'
$RepoPath = 'C:\Users\nicolas.rivera\projects\front-kronos-test'
$NodeExe = 'C:\nvm4w\nodejs\node.exe'
$NpxCli = 'C:\nvm4w\nodejs\node_modules\npm\bin\npx-cli.js'
$ScriptRel = 'scripts\service-layer-metrics-daily-job.ts'
$LogFile = "$RepoPath\logs\service-layer-metrics-daily-job.log"

if (-not (Test-Path "$RepoPath\logs")) {
  New-Item -ItemType Directory -Force -Path "$RepoPath\logs" | Out-Null
}

# cmd /c para poder redirigir stdout/stderr a un log (Register-ScheduledTask
# no tiene un mecanismo nativo de redirección de salida).
$cmdArgument = "/c `"`"$NodeExe`" `"$NpxCli`" tsx `"$ScriptRel`" >> `"$LogFile`" 2>&1`""

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmdArgument -WorkingDirectory $RepoPath
$trigger = New-ScheduledTaskTrigger -Daily -At 1am
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal -UserId 'dfaruniadm\nicolas.rivera' -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description 'Job diario (01:00 am): cuenta el log del SAP Service Layer de OLP en serfarma07 via SSH puntual y hace upsert en service_layer_daily_metrics (front-kronos-test). Registrada 2026-09-03.' `
  -Force | Out-Null

Write-Output "Tarea '$TaskName' registrada."
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName $TaskName | Select-Object LastRunTime, LastTaskResult, NextRunTime
