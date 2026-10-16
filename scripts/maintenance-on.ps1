<#
.SYNOPSIS
  Activa la pagina "SynerLink se esta actualizando" en IIS (crea la bandera).

.DESCRIPTION
  Crea <SitePath>\mantenimiento.flag y toca el web.config del sitio para
  vaciar la cache de reglas de URL Rewrite. Mientras exista, la regla de URL Rewrite
  "Mantenimiento - bandera" (deploy/iis/web.config) responde 503 + Retry-After
  a todo el publico del :8445 con la pagina estatica, sin pasar por Node.
  No toca PM2 ni la app: solo la bandera. Es idempotente.

  Requiere haber corrido antes scripts/iis-setup-maintenance.ps1 en el servidor.
  Los agentes que publican directo a http://192.168.10.5:3003 NO se ven afectados.

  Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\maintenance-on.ps1 -Motivo "npm install por dependencia nueva"
#>
param(
  [string]$SitePath = 'C:\inetpub\wwwroot\GSS',
  [string]$Motivo = 'mantenimiento manual'
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

if (-not (Test-Path -LiteralPath $SitePath -PathType Container)) {
  throw "No existe la carpeta del sitio IIS: $SitePath"
}
$pagina = Join-Path $SitePath '_mantenimiento\index.html'
if (-not (Test-Path -LiteralPath $pagina)) {
  Write-Warning "No esta instalada la pagina ($pagina). Corra scripts\iis-setup-maintenance.ps1; sin ella el publico vera un 503 generico."
}

$bandera = Join-Path $SitePath 'mantenimiento.flag'
$contenido = @(
  "activada=$((Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz'))",
  "por=$env:USERDOMAIN\$env:USERNAME",
  "equipo=$env:COMPUTERNAME",
  "motivo=$Motivo"
)
if ($env:GITHUB_RUN_ID) { $contenido += "github_run=$env:GITHUB_SERVER_URL/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID" }

Set-Content -LiteralPath $bandera -Value $contenido -Encoding ASCII
Reset-CacheRewrite $SitePath
Write-Host "Mantenimiento ACTIVADO: $bandera"
Get-Content -LiteralPath $bandera | ForEach-Object { Write-Host "  $_" }
