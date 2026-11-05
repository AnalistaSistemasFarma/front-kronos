<#
.SYNOPSIS
  Sube (o revierte) el tope de tamano del cuerpo de las peticiones en el sitio IIS
  de SynerLink (requestFiltering/requestLimits maxAllowedContentLength).

.DESCRIPTION
  Contexto (2026-10-30): los adjuntos de mas de ~10 MB del chat fallaban con un 400
  generico. La causa era Next.js (experimental.middlewareClientMaxBodySize, 10 MB por
  defecto), que se corrige en next.config.ts (30 MB). IIS, por defecto, deja pasar
  30.000.000 bytes: un poco MENOS que los 30 MB de Next, y lo que se pasa recibe un
  404.13 en HTML de IIS en vez del 413 claro de la app. Este script lo sube a 64 MB.

  Idempotente. Corre en el servidor (serfarma05), como administrador. Hace:
    1. Verifica que exista SitePath\web.config.
    2. Respaldo: copia el web.config actual a BackupRoot\<fecha>\web.config.
    3. Edita SOLO el nodo system.webServer/security/requestFiltering/requestLimits
       (atributo maxAllowedContentLength), conservando comentarios y formato.
    4. Valida que IIS lea la configuracion (appcmd list config) y hace una prueba
       HTTP local. Si algo falla, restaura el respaldo y termina con error.

  -Rollback restaura el web.config del respaldo mas reciente (o el de -Stamp).
  NO toca PM2, Node ni la bandera de mantenimiento. No requiere reiniciar IIS: el
  cambio de web.config se toma en caliente.
  Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\iis-request-limits.ps1 -WhatIf
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\iis-request-limits.ps1
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\iis-request-limits.ps1 -Rollback
#>
param(
  [string]$SiteName = 'groupsharedservices',
  [string]$SitePath = 'C:\inetpub\wwwroot\GSS',
  [string]$HostName = 'groupsharedservices.farmalogica.com',
  [int]$Port = 8445,
  [string]$Scheme = 'https',
  [long]$MaxBytes = 67108864,
  [string]$BackupRoot = 'C:\inetpub\synerlink-request-limits-respaldos',
  [string]$Stamp = '',
  [switch]$Rollback,
  [switch]$SkipSmoke,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$appcmd = Join-Path $env:windir 'system32\inetsrv\appcmd.exe'
$webConfig = Join-Path $SitePath 'web.config'

function Paso([string]$texto) { Write-Host "-- $texto" }

function Get-LimiteEfectivo {
  $salida = & $appcmd list config $SiteName '-section:system.webServer/security/requestFiltering' '/config:*' 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "appcmd no pudo leer la configuracion de ${SiteName}: $salida" }
  if ($salida -match 'maxAllowedContentLength="(\d+)"') { return [long]$Matches[1] }
  throw "No se encontro maxAllowedContentLength en la configuracion efectiva: $salida"
}

function Test-Smoke {
  if ($SkipSmoke) { Write-Host "   (prueba HTTP omitida por -SkipSmoke)"; return }
  $resolve = "${HostName}:${Port}:127.0.0.1"
  $url = "${Scheme}://${HostName}:${Port}/api/health/version"
  $codigo = & curl.exe -sk -o NUL -w '%{http_code}' --max-time 20 --resolve $resolve $url
  Write-Host "   GET $url -> $codigo"
  if ($codigo -ne '200') { throw "La prueba HTTP local devolvio $codigo" }
}

if (-not (Test-Path -LiteralPath $webConfig)) { throw "No existe $webConfig" }

if ($Rollback) {
  if (-not $Stamp) {
    $ultimo = Get-ChildItem -LiteralPath $BackupRoot -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending | Select-Object -First 1
    if (-not $ultimo) { throw "No hay respaldos en $BackupRoot" }
    $Stamp = $ultimo.Name
  }
  $respaldo = Join-Path $BackupRoot "$Stamp\web.config"
  if (-not (Test-Path -LiteralPath $respaldo)) { throw "No existe el respaldo $respaldo" }
  Paso "Reversa con el respaldo $Stamp"
  if ($WhatIf) { Write-Host "[WhatIf] Copy-Item $respaldo -> $webConfig"; return }
  Copy-Item -LiteralPath $respaldo -Destination $webConfig -Force
  Write-Host "   Limite efectivo ahora: $(Get-LimiteEfectivo) bytes"
  Test-Smoke
  Write-Host "Reversa lista."
  return
}

$actual = Get-LimiteEfectivo
Paso "Limite efectivo actual: $actual bytes; objetivo: $MaxBytes bytes"
if ($actual -eq $MaxBytes) { Write-Host "Ya esta en $MaxBytes. Nada que hacer."; return }

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dirRespaldo = Join-Path $BackupRoot $Stamp
if ($WhatIf) {
  Write-Host "[WhatIf] respaldo: $webConfig -> $dirRespaldo\web.config"
  Write-Host "[WhatIf] requestLimits maxAllowedContentLength=$MaxBytes en $webConfig"
  return
}

Paso "Respaldo en $dirRespaldo"
New-Item -ItemType Directory -Path $dirRespaldo -Force | Out-Null
Copy-Item -LiteralPath $webConfig -Destination (Join-Path $dirRespaldo 'web.config') -Force

try {
  Paso "Editando requestLimits"
  $xml = New-Object System.Xml.XmlDocument
  $xml.PreserveWhitespace = $true
  $xml.Load($webConfig)
  $ws = $xml.SelectSingleNode('/configuration/system.webServer')
  if (-not $ws) { throw "web.config sin system.webServer" }
  $nodo = $ws
  foreach ($nombre in @('security', 'requestFiltering', 'requestLimits')) {
    $hijo = $nodo.SelectSingleNode($nombre)
    if (-not $hijo) { $hijo = $nodo.AppendChild($xml.CreateElement($nombre)) }
    $nodo = $hijo
  }
  $nodo.SetAttribute('maxAllowedContentLength', [string]$MaxBytes)

  $settings = New-Object System.Xml.XmlWriterSettings
  $settings.Encoding = New-Object System.Text.UTF8Encoding($false)
  $writer = [System.Xml.XmlWriter]::Create($webConfig, $settings)
  try { $xml.Save($writer) } finally { $writer.Close() }

  $nuevo = Get-LimiteEfectivo
  Write-Host "   Limite efectivo ahora: $nuevo bytes"
  if ($nuevo -ne $MaxBytes) { throw "IIS no tomo el valor nuevo ($nuevo)" }
  Test-Smoke
} catch {
  Write-Host "ERROR: $($_.Exception.Message). Restaurando el respaldo." -ForegroundColor Red
  Copy-Item -LiteralPath (Join-Path $dirRespaldo 'web.config') -Destination $webConfig -Force
  throw
}

Write-Host "Listo. Respaldo: $dirRespaldo  (reversa: -Rollback -Stamp $Stamp)"
