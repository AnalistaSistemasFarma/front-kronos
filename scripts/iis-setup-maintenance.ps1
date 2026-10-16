<#
.SYNOPSIS
  Instala (o revierte) en IIS la pagina "SynerLink se esta actualizando".

.DESCRIPTION
  Idempotente. Corre en el servidor (serfarma05), como administrador, desde el
  checkout del repo. Hace, en este orden:
    1. Verifica que el sitio exista, que su carpeta sea SitePath y que URL Rewrite
       este instalado.
    2. Respaldo: `appcmd add backup` (applicationHost.config completo) y copia del
       web.config actual a BackupRoot\<fecha>\.
    3. Permite la variable RESPONSE_Retry_After para el sitio (allowedServerVariables,
       va en applicationHost.config con /commit:apphost). Debe ir ANTES del
       web.config: sin ella la regla de mantenimiento daria 500.50.
    4. Copia deploy\iis\_mantenimiento\ a SitePath\_mantenimiento\.
    5. Reemplaza SitePath\web.config por deploy\iis\web.config (solo si cambio).
    6. Valida que IIS lea la configuracion y hace una prueba HTTP local. Si algo
       falla, restaura el web.config anterior y termina con error.

  -Rollback deja el sitio como estaba: restaura el web.config del respaldo mas
  reciente (o el de -Stamp), borra la bandera y la carpeta _mantenimiento y quita
  RESPONSE_Retry_After de allowedServerVariables.

  NO toca PM2, Node ni la bandera (salvo en -Rollback).
  Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.

.EXAMPLE
  # Ensayo: solo muestra que haria
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\iis-setup-maintenance.ps1 -WhatIf
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\iis-setup-maintenance.ps1
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\iis-setup-maintenance.ps1 -Rollback
#>
param(
  [string]$SiteName = 'groupsharedservices',
  [string]$SitePath = 'C:\inetpub\wwwroot\GSS',
  [string]$HostName = 'groupsharedservices.farmalogica.com',
  [int]$Port = 8445,
  [string]$Scheme = 'https',
  [string]$WebConfigSource = (Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy\iis\web.config'),
  [string]$PageSource = (Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy\iis\_mantenimiento'),
  [string]$BackupRoot = 'C:\inetpub\synerlink-mantenimiento-respaldos',
  [string]$Stamp = '',
  [switch]$Rollback,
  [switch]$SkipSmoke,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$appcmd = Join-Path $env:windir 'system32\inetsrv\appcmd.exe'
$variable = 'RESPONSE_Retry_After'

function Invoke-Appcmd {
  param([string[]]$Argumentos)
  $salida = & $appcmd @Argumentos 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "appcmd $($Argumentos -join ' ') fallo ($LASTEXITCODE): $salida" }
  return $salida
}

function Paso([string]$texto) { Write-Host "== $texto" }

function Test-Http {
  param([string]$Ruta)
  $url = "{0}://{1}:{2}{3}" -f $Scheme, $HostName, $Port, $Ruta
  $resolve = "{0}:{1}:127.0.0.1" -f $HostName, $Port
  $codigo = & curl.exe -sk -o NUL -w '%{http_code}' --max-time 20 --resolve $resolve $url
  return [int]$codigo
}

function Test-Smoke {
  if ($SkipSmoke) { Write-Host "   (prueba HTTP omitida por -SkipSmoke)"; return }
  $p = Test-Http '/_mantenimiento/index.html'
  Write-Host "   /_mantenimiento/index.html -> $p"
  if ($p -ne 200) { throw "La pagina de mantenimiento no responde 200 (respondio $p)" }
  $r = Test-Http '/'
  Write-Host "   / (desde 127.0.0.1, sin bandera para este origen) -> $r"
  if ($r -eq 0 -or $r -ge 500) { throw "El sitio responde $r en / tras el cambio" }
}

# --- 0. Prerrequisitos -------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Ejecute este script como administrador.'
}
if (-not (Test-Path -LiteralPath $appcmd)) { throw "No se encontro $appcmd (IIS no instalado?)" }
if (-not (Test-Path -LiteralPath (Join-Path $env:windir 'system32\inetsrv\rewrite.dll'))) {
  throw 'El modulo URL Rewrite no esta instalado.'
}

Paso "Sitio '$SiteName'"
$vdir = Invoke-Appcmd @('list', 'vdir', "/app.name:$SiteName/")
Write-Host "   $($vdir.Trim())"
if ($vdir -notmatch [regex]::Escape("physicalPath:$SitePath)")) {
  throw "La carpeta fisica del sitio no es $SitePath. Revise -SiteName / -SitePath."
}

$webConfig = Join-Path $SitePath 'web.config'
$paginaDestino = Join-Path $SitePath '_mantenimiento'

# --- Reversa -----------------------------------------------------------------
if ($Rollback) {
  if (-not $Stamp) {
    $ultimo = Get-ChildItem -LiteralPath $BackupRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path (Join-Path $_.FullName "$SiteName.web.config") } |
      Sort-Object Name -Descending | Select-Object -First 1
    if (-not $ultimo) { throw "No hay respaldos de $SiteName en $BackupRoot" }
    $Stamp = $ultimo.Name
  }
  $respaldo = Join-Path $BackupRoot "$Stamp\$SiteName.web.config"
  if (-not (Test-Path -LiteralPath $respaldo)) { throw "No existe el respaldo $respaldo" }
  Paso "Reversa con el respaldo $Stamp"
  if ($WhatIf) {
    Write-Host "   [WhatIf] copiaria $respaldo -> $webConfig, borraria la bandera y $paginaDestino y quitaria $variable"
    exit 0
  }
  Copy-Item -LiteralPath $respaldo -Destination $webConfig -Force
  Write-Host "   web.config restaurado"
  Remove-Item -LiteralPath (Join-Path $SitePath 'mantenimiento.flag') -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $paginaDestino) { Remove-Item -LiteralPath $paginaDestino -Recurse -Force }
  $permitidas = Invoke-Appcmd @('list', 'config', "$SiteName/", '-section:system.webServer/rewrite/allowedServerVariables')
  $restauradoUsaVariable = (Get-Content -LiteralPath $webConfig -Raw) -match $variable
  if ($restauradoUsaVariable) {
    Write-Host "   el web.config restaurado usa $variable; se deja permitida"
  } elseif ($permitidas -match $variable) {
    Invoke-Appcmd @('set', 'config', $SiteName, '-section:system.webServer/rewrite/allowedServerVariables', "/-[name='$variable']", '/commit:apphost') | Out-Null
    Write-Host "   $variable retirada de allowedServerVariables"
  }
  Invoke-Appcmd @('list', 'config', "$SiteName/", '-section:system.webServer/rewrite/rules') | Out-Null
  if (-not $SkipSmoke) {
    $r = Test-Http '/'
    Write-Host "   / -> $r"
  }
  Write-Host "Reversa terminada."
  exit 0
}

# --- Instalacion ---------------------------------------------------------------
foreach ($f in @($WebConfigSource, (Join-Path $PageSource 'index.html'))) {
  if (-not (Test-Path -LiteralPath $f)) { throw "Falta el archivo fuente $f" }
}

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dirRespaldo = Join-Path $BackupRoot $Stamp
$cambiaWebConfig = $true
if (Test-Path -LiteralPath $webConfig) {
  $cambiaWebConfig = (Get-FileHash -LiteralPath $webConfig).Hash -ne (Get-FileHash -LiteralPath $WebConfigSource).Hash
}

if ($WhatIf) {
  Write-Host "[WhatIf] appcmd add backup antes-mantenimiento-$Stamp"
  Write-Host "[WhatIf] respaldo de $webConfig en $dirRespaldo"
  Write-Host "[WhatIf] permitir $variable en allowedServerVariables (/commit:apphost) si falta"
  Write-Host "[WhatIf] copiar $PageSource -> $paginaDestino"
  Write-Host "[WhatIf] reemplazar web.config: $cambiaWebConfig"
  exit 0
}

Paso 'Respaldo'
Invoke-Appcmd @('add', 'backup', "antes-mantenimiento-$Stamp") | Out-Null
Write-Host "   appcmd backup: antes-mantenimiento-$Stamp"
New-Item -ItemType Directory -Force -Path $dirRespaldo | Out-Null
# El web.config se respalda solo si va a cambiar: asi -Rollback siempre vuelve a
# la version ANTERIOR real y no a una copia identica de la del repo.
if ($cambiaWebConfig -and (Test-Path -LiteralPath $webConfig)) {
  Copy-Item -LiteralPath $webConfig -Destination (Join-Path $dirRespaldo "$SiteName.web.config")
  Write-Host "   web.config: $dirRespaldo\$SiteName.web.config"
}

Paso "allowedServerVariables: $variable"
$permitidas = Invoke-Appcmd @('list', 'config', "$SiteName/", '-section:system.webServer/rewrite/allowedServerVariables')
if ($permitidas -match $variable) {
  Write-Host '   ya estaba permitida'
} else {
  Invoke-Appcmd @('set', 'config', $SiteName, '-section:system.webServer/rewrite/allowedServerVariables', "/+[name='$variable']", '/commit:apphost') | Out-Null
  Write-Host '   agregada (applicationHost.config, location del sitio)'
}

Paso 'Pagina de mantenimiento'
New-Item -ItemType Directory -Force -Path $paginaDestino | Out-Null
Copy-Item -Path (Join-Path $PageSource '*') -Destination $paginaDestino -Recurse -Force
Write-Host "   $paginaDestino"

Paso 'web.config'
if (-not $cambiaWebConfig) {
  Write-Host '   sin cambios (ya es la version del repo)'
} else {
  $tmp = Join-Path $SitePath "web.config.nuevo-$Stamp"
  Copy-Item -LiteralPath $WebConfigSource -Destination $tmp -Force
  Move-Item -LiteralPath $tmp -Destination $webConfig -Force
  Write-Host '   reemplazado'
}

Paso 'Validacion'
try {
  $reglas = Invoke-Appcmd @('list', 'config', "$SiteName/", '-section:system.webServer/rewrite/rules')
  if ($reglas -notmatch 'Mantenimiento - bandera') { throw 'IIS no ve la regla "Mantenimiento - bandera"' }
  $errores = Invoke-Appcmd @('list', 'config', "$SiteName/", '-section:system.webServer/httpErrors')
  if ($errores -notmatch '_mantenimiento[\\/]index\.html') { throw 'IIS no ve la pagina en httpErrors' }
  Start-Sleep -Seconds 2
  Test-Smoke
} catch {
  $previo = Join-Path $dirRespaldo "$SiteName.web.config"
  if ($cambiaWebConfig -and (Test-Path -LiteralPath $previo)) {
    Copy-Item -LiteralPath $previo -Destination $webConfig -Force
    Write-Host "   FALLO la validacion: se restauro el web.config anterior ($previo)"
  }
  throw
}

Write-Host ''
Write-Host "Listo. Respaldo: $dirRespaldo (appcmd: antes-mantenimiento-$Stamp)"
Write-Host 'Activar:    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\maintenance-on.ps1'
Write-Host 'Desactivar: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\maintenance-off.ps1'
Write-Host 'Reversa:    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\iis-setup-maintenance.ps1 -Rollback'
