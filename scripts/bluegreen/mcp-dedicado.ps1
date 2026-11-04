# MCP en carpeta DEDICADA (mcp.mode = 'dedicated', PRODUCCION en serfarma05).
# Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.
#
# Por que: kronos-mcp carga el cliente Prisma de ../app/generated/prisma (su
# query_engine-windows.dll.node) y su propio mcp\node_modules. Si corriera
# desde una carpeta de color, el build de ese color (cuando queda inactivo)
# chocaria con el DLL cargado (EPERM) y habria que moverlo en CADA deploy. La
# regla de Nicolas (2026-10-06) prohibe 2 instancias de un conector, asi que no
# puede tener su propio azul/verde de procesos. Solucion:
#   - Corre siempre desde mcp.root (p. ej. projects\front-kronos-mcp), que solo
#     contiene una COPIA de mcp\ y de app\generated\prisma (+ @prisma\client)
#     tomada de un color ya compilado, y enlaces a los .env / log de auditoria
#     de la carpeta canonica (nunca se copian secretos).
#   - Solo se actualiza cuando cambiaron mcp/, prisma/ o la version de Prisma
#     desde el sha que tiene (.bluegreen-mcp.json). Si no, el deploy no lo toca.
#   - La copia nueva se arma en <root>.nuevo SIN detener nada y se prueba que
#     cargue (import de dist y del cliente Prisma, sin escuchar puertos).
#   - Hueco unico de segundos: pm2 delete -> renombrar carpetas -> pm2 start ->
#     /health 200. Si no responde, vuelve a la carpeta anterior (<root>.anterior).
#
# Requiere lib.ps1 cargado antes.

function Get-McpRoot($Cfg) {
  $r = Get-Opt $Cfg 'mcp.root' $null
  if (-not $r) { throw "Falta mcp.root en bluegreen.json (modo dedicated)." }
  return ([string]$r).TrimEnd('\')
}

function Test-McpNeedsUpdate($Cfg, [string]$NewDir, [string]$Sha) {
  # Devuelve el motivo (texto) si hay que actualizar la carpeta del MCP, o $null.
  $root = Get-McpRoot $Cfg
  $st = Read-JsonFile (Join-Path $root '.bluegreen-mcp.json')
  if (-not $st -or -not $st.sha) { return "la carpeta dedicada no tiene sello" }
  if ($st.sha -eq $Sha) { return $null }
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    git -C $NewDir diff --quiet $st.sha $Sha -- mcp prisma 2>$null
    $rc = $LASTEXITCODE
    if ($rc -eq 1) { return "cambios en mcp/ o prisma/ entre $($st.sha.Substring(0,8)) y $($Sha.Substring(0,8))" }
    if ($rc -ne 0) { return "no se pudo comparar $($st.sha.Substring(0,8))..$($Sha.Substring(0,8)) (git rc $rc)" }
    $pk = (git -C $NewDir diff $st.sha $Sha -- package.json 2>$null) -join "`n"
    if ($pk -match '(?m)^[+-]\s*"(@prisma/client|prisma)"') { return "cambio la version de Prisma en package.json" }
  } finally { $ErrorActionPreference = $prev }
  return $null
}

function Invoke-Robocopy([string]$Src, [string]$Dst, [string[]]$Extra) {
  $a = @($Src, $Dst, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1', '/MT:8') + $Extra
  & robocopy @a | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy $Src -> $Dst fallo (codigo $LASTEXITCODE)" }
}

function New-McpStaging($Cfg, [string]$SourceDir, [string]$Sha) {
  # Arma <root>.nuevo desde una carpeta YA COMPILADA (mcp\dist y
  # app\generated\prisma presentes). No detiene nada.
  $root = Get-McpRoot $Cfg
  $stg = "$root.nuevo"
  if (-not (Test-Path -LiteralPath (Join-Path $SourceDir 'mcp\dist\server.js'))) { throw "$SourceDir\mcp\dist\server.js no existe (MCP sin compilar)." }
  if (-not (Test-Path -LiteralPath (Join-Path $SourceDir 'app\generated\prisma\index.js'))) { throw "$SourceDir\app\generated\prisma\index.js no existe (falta prisma generate)." }
  if (Test-Path -LiteralPath $stg) {
    Clear-OrphansInDir $Cfg $stg
    Remove-Item -LiteralPath $stg -Recurse -Force
  }
  New-Item -ItemType Directory -Path $stg | Out-Null
  # Nunca se copian secretos ni logs: .env* y *.log se ENLAZAN despues.
  Invoke-Robocopy (Join-Path $SourceDir 'mcp') (Join-Path $stg 'mcp') @('/XF', '.env*', '*.log', '/XD', 'test', 'test-integracion')
  Invoke-Robocopy (Join-Path $SourceDir 'app\generated\prisma') (Join-Path $stg 'app\generated\prisma') @('/XF', '*.tmp*')
  if (Test-Path -LiteralPath (Join-Path $SourceDir 'node_modules\@prisma\client')) {
    Invoke-Robocopy (Join-Path $SourceDir 'node_modules\@prisma\client') (Join-Path $stg 'node_modules\@prisma\client') @()
  }
  foreach ($rel in @(Get-Opt $Cfg 'mcp.links' @('.env', 'mcp\.env'))) {
    if (-not $rel) { continue }
    $src = Join-Path $Cfg.linkFrom $rel
    $dst = Join-Path $stg $rel
    if (-not (Test-Path -LiteralPath $src)) { Write-Host "::warning::No existe $src; no se enlaza $rel"; continue }
    New-Item -ItemType SymbolicLink -Path $dst -Target $src | Out-Null
  }
  if (-not (Test-Path -LiteralPath (Join-Path $stg 'mcp\.env'))) { throw "FALTA mcp\.env en $stg" }
  Write-JsonFile (Join-Path $stg '.bluegreen-mcp.json') ([ordered]@{ sha = $Sha; from = $SourceDir; builtAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz') })
  Test-McpLoads $Cfg $stg
  return $stg
}

function Test-McpLoads($Cfg, [string]$Dir) {
  # Carga los modulos del MCP y del cliente Prisma SIN escuchar ningun puerto ni
  # conectarse a la base (no es una segunda instancia: el proceso termina solo).
  $js = @'
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const base = process.cwd();
await import(pathToFileURL(join(base, 'dist', 'config.js')).href);
await import(pathToFileURL(join(base, 'dist', 'db.js')).href);
const req = createRequire(join(base, 'serve.mjs'));
const { PrismaClient } = req(join(base, '..', 'app', 'generated', 'prisma', 'index.js'));
if (typeof PrismaClient !== 'function') throw new Error('PrismaClient no es una clase');
console.log('carga OK');
process.exit(0);
'@
  $tmp = Join-Path $Dir 'mcp\.bluegreen-carga.mjs'
  [IO.File]::WriteAllText($tmp, $js, (New-Object Text.UTF8Encoding($false)))
  Push-Location (Join-Path $Dir 'mcp')
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $out = (& $Cfg.node $tmp 2>&1) -join ' '
    $rc = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev; Pop-Location; Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  if ($rc -ne 0) { throw "La copia del MCP en $Dir no carga: $out" }
  Write-Host "MCP en $Dir`: $out"
}

function Rename-Dir([string]$From, [string]$To) {
  for ($i = 1; $i -le 10; $i++) {
    try { Rename-Item -LiteralPath $From -NewName (Split-Path $To -Leaf) -ErrorAction Stop; return } catch {
      if ($i -eq 10) { throw "No se pudo renombrar $From -> $To`: $($_.Exception.Message)" }
      Start-Sleep -Milliseconds 500
    }
  }
}

function Wait-McpHealthy($Cfg, [int]$TimeoutSec = 60) {
  $url = "http://127.0.0.1:$($Cfg.mcp.port)/health"
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $TimeoutSec) {
    if ((Get-HttpStatus $url 5) -eq 200) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Switch-McpDedicated($Cfg, [string]$StateDir, [string]$Staging, $FallbackApp = $null) {
  # Hueco unico: delete -> (renombrar) -> start -> /health. Nunca 2 instancias.
  # $FallbackApp: declaracion pm2 a restaurar si NO existe <root> todavia
  # (activacion: el MCP viene de la carpeta del front, no de <root>).
  # Cualquier error despues del delete cae en la reversa: el MCP nunca queda
  # abajo por una excepcion del script.
  $root = Get-McpRoot $Cfg
  $prevDir = "$root.anterior"
  $port = [int]$Cfg.mcp.port
  $hadRoot = Test-Path -LiteralPath $root
  if ($hadRoot -and (Test-Path -LiteralPath $prevDir)) {
    Clear-OrphansInDir $Cfg $prevDir
    Remove-Item -LiteralPath $prevDir -Recurse -Force
  }
  $oldOrigin = if ($hadRoot) { $root } elseif ($FallbackApp) { Split-Path $FallbackApp.cwd -Parent } else { $null }

  $tGap = Get-Date
  $movedOld = $false; $movedNew = $false; $err = $null
  Remove-Pm2App $Cfg.mcp.name
  try {
    Wait-PortFree $port $oldOrigin 15 $Cfg
    if ($hadRoot) {
      Clear-OrphansInDir $Cfg $root
      Rename-Dir $root $prevDir; $movedOld = $true
    }
    Rename-Dir $Staging $root; $movedNew = $true
    Start-Pm2Declared $StateDir (New-McpAppAt $Cfg $root)
    if (Wait-McpHealthy $Cfg 60) {
      [void](Invoke-Pm2 save)
      return @{ ok = $true; message = ("MCP {0} en linea desde {1}; hueco {2:N1} s" -f $Cfg.mcp.name, $root, ((Get-Date) - $tGap).TotalSeconds) }
    }
    $err = "no respondio /health desde $root"
  } catch { $err = $_.Exception.Message }

  # ---- reversa del MCP
  Write-Host "::warning::$($Cfg.mcp.name): $err. Vuelvo a la version anterior."
  try {
    Remove-Pm2App $Cfg.mcp.name
    try { Wait-PortFree $port $root 15 $Cfg } catch { Write-Host "::warning::$($_.Exception.Message)" }
    if ($movedNew) {
      try { Clear-OrphansInDir $Cfg $root } catch { Write-Host "::warning::$($_.Exception.Message)" }
      Rename-Dir $root "$root.fallido-$(Get-Date -Format yyyyMMddHHmmss)"
    }
    if ($movedOld) { Rename-Dir $prevDir $root }
    if ($hadRoot) { Start-Pm2Declared $StateDir (New-McpAppAt $Cfg $root) }
    elseif ($FallbackApp) { Start-Pm2Declared $StateDir $FallbackApp }
  } catch { Write-Host "::error::Reversa del MCP con error: $($_.Exception.Message)" }
  $back = Wait-McpHealthy $Cfg 60
  [void](Invoke-Pm2 save)
  $msg = if ($back) { "MCP nuevo fallo ($err); se restauro la version anterior (responde /health)." } else { "MCP nuevo fallo ($err) y la version anterior TAMPOCO responde /health. Revisar pm2 logs $($Cfg.mcp.name)." }
  return @{ ok = $false; message = $msg }
}
