<#
.SYNOPSIS
  Quita la pagina "SynerLink se esta actualizando" (borra la bandera), pero solo
  si GSS-Front ya responde.

.DESCRIPTION
  Antes de borrar <SitePath>\mantenimiento.flag comprueba que la app responde
  HTTP 200 en HealthUrl (por defecto http://localhost:3003/, siguiendo
  redirecciones), con reintentos. Asi:
    - si la app quedo arriba, la bandera se borra y el publico vuelve a SynerLink;
    - si la app NO quedo arriba, la bandera se conserva (la pagina de
      mantenimiento es lo correcto) y el script termina con codigo 1.
  Al borrarla toca el web.config para vaciar la cache de URL Rewrite.
  Si la bandera no existe, termina en 0 sin hacer nada.
  -Force la borra sin verificar (uselo solo si sabe lo que hace).

  Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\maintenance-off.ps1
#>
param(
  [string]$SitePath = 'C:\inetpub\wwwroot\GSS',
  [string]$HealthUrl = 'http://localhost:3003/',
  [int]$Intentos = 24,
  [int]$EsperaSegundos = 5,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

# URL Rewrite guarda en cache, por URL, el resultado de evaluar las reglas
# (incluida la condicion IsFile de la bandera). Sin invalidarla, las URLs que ya
# se habian visitado siguen yendo a Node aunque exista la bandera (y al quitarla
# seguirian mostrando la pagina). Tocar la fecha del web.config hace que IIS
# relea la configuracion del sitio y vacie esa cache. No recicla el app pool.
# Comprobado en un sitio temporal de la .230 el 2026-10-07.
function Reset-CacheRewrite([string]$Carpeta) {
  $wc = Join-Path $Carpeta 'web.config'
  if (Test-Path -LiteralPath $wc) {
    (Get-Item -LiteralPath $wc).LastWriteTime = Get-Date
    Write-Host "Cache de URL Rewrite invalidada (se toco $wc)"
  } else {
    Write-Warning "No existe $wc; no se pudo invalidar la cache de URL Rewrite."
  }
}

$bandera = Join-Path $SitePath 'mantenimiento.flag'
if (-not (Test-Path -LiteralPath $bandera)) {
  Write-Host "No hay bandera de mantenimiento ($bandera). Nada que hacer."
  exit 0
}

Write-Host "Bandera actual:"
Get-Content -LiteralPath $bandera | ForEach-Object { Write-Host "  $_" }

if (-not $Force) {
  $ok = $false
  for ($i = 1; $i -le $Intentos; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri $HealthUrl
      Write-Host "Intento $i -> HTTP $($r.StatusCode)"
      if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch {
      Write-Host "Intento $i -> sin respuesta valida: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds $EsperaSegundos
  }
  if (-not $ok) {
    Write-Host "::warning::GSS-Front no respondio 200 en $HealthUrl. Se CONSERVA la pagina de mantenimiento. Cuando la app quede arriba, corra scripts\maintenance-off.ps1."
    exit 1
  }
}

Remove-Item -LiteralPath $bandera -Force
Reset-CacheRewrite $SitePath
Write-Host "Mantenimiento DESACTIVADO: se borro $bandera"
