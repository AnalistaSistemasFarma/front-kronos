# Prueba E2E local Orion ↔ Kronos
# Uso: powershell -ExecutionPolicy Bypass -File scripts/run-orion-e2e.ps1
# Opcional: -Email tu@empresa.com

param(
  [string]$Email = ""
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

Write-Host "`n=== Orion + Kronos — prueba local ===" -ForegroundColor Cyan

function Test-Port {
  param([int]$Port)
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", $Port)
    $tcp.Close()
    return $true
  } catch {
    return $false
  }
}

$kronosUp = Test-Port 8080
$orionUp = Test-Port 3000

Write-Host "`nServicios:" -ForegroundColor Yellow
Write-Host "  Kronos (8080): $(if ($kronosUp) { 'OK' } else { 'NO CORRE — ejecuta npm run dev' })"
Write-Host "  Orion  (3000): $(if ($orionUp) { 'OK' } else { 'NO CORRE — ejecuta npm run dev en front-orion' })"

if (-not $kronosUp) {
  Write-Host "`nLevanta Kronos en otra terminal: npm run dev" -ForegroundColor Red
}

if (-not $orionUp) {
  Write-Host "Levanta Orion en otra terminal (front-orion): npm run dev" -ForegroundColor Red
}

Write-Host "`n--- 1) Seed proceso Firma de documento ---" -ForegroundColor Cyan
$seedArgs = @("run", "seed:orion")
if ($Email) { $seedArgs += "--"; $seedArgs += "--email=$Email" }
$seed = Start-Process -FilePath "npm" -ArgumentList $seedArgs -NoNewWindow -Wait -PassThru -WorkingDirectory $root
if ($seed.ExitCode -ne 0) {
  Write-Host "Seed falló (exit $($seed.ExitCode))" -ForegroundColor Red
} else {
  Write-Host "Seed OK" -ForegroundColor Green
}

Write-Host "`n--- 2) Test API Orion + webhook Kronos ---" -ForegroundColor Cyan
$test = Start-Process -FilePath "npm" -ArgumentList @("run", "test:orion") -NoNewWindow -Wait -PassThru -WorkingDirectory $root

Write-Host "`n--- 3) Health Kronos ---" -ForegroundColor Cyan
if ($kronosUp) {
  try {
    $health = Invoke-RestMethod -Uri "http://localhost:8080/api/integrations/orion/health" -TimeoutSec 10
    $health | ConvertTo-Json -Depth 4
  } catch {
    Write-Host "Health falló: $($_.Exception.Message)" -ForegroundColor Red
  }
} else {
  Write-Host "(omitido — Kronos no está en 8080)" -ForegroundColor DarkYellow
}

Write-Host "`n--- 4) Prueba UI manual ---" -ForegroundColor Cyan
Write-Host "  1. http://localhost:8080 → login"
Write-Host "  2. Crear solicitud proceso 'Firma de documento'"
Write-Host "  3. Abrir solicitud → iframe GSS Firma"
Write-Host "  4. Firmar → refrescar → tarea resuelta"

Write-Host "`n=== Fin (test:orion exit $($test.ExitCode)) ===" -ForegroundColor Cyan
exit $test.ExitCode
