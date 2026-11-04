<#
.SYNOPSIS
  REVERSA del azul/verde de PRODUCCION (serfarma05): vuelve al esquema de
  siempre (GSS-Front cluster x2 en :3003 y kronos-mcp desde front-kronos\mcp).

.DESCRIPTION
  Se corre por SSH como administrador. Con -WhatIf solo lee e imprime el plan
  (no llama a pm2 ni escribe nada).
    0. Prechecks sin pm2: daemon del servicio 0pm2.exe, color activo, build de
       A (.next\BUILD_ID, mcp\dist, cliente Prisma).
    1. Respaldo: copia active.json y bluegreen.json a <estado>.respaldo-<fecha>.
    2. CORTE del front: pm2 delete GSS-Front-proxy (libera :3003) y arranca
       GSS-Front (cluster x2, cwd front-kronos, PORT 3003) como antes. Si no
       responde, vuelve a poner el proxy (el estado azul/verde sigue intacto).
    3. CORTE del MCP: si corre desde la carpeta dedicada, vuelve a
       front-kronos\mcp (delete + start, una sola instancia). Si no responde,
       vuelve a la carpeta dedicada.
    4. Borra de pm2 GSS-Front-A / -B; pm2 save.
    5. Archiva la carpeta de estado (*.revertido-<fecha>); con -RemoveFolders
       borra el worktree B y la carpeta dedicada del MCP (si no, quedan en
       disco sin uso).

  OJO: A sirve el ultimo build que se hizo EN A. Si el activo es B, A queda una
  version atras: hace falta -Force (o, mejor, antes `switch.ps1 -Rollback` /
  un deploy que deje A activo). Despues revierta el PR del workflow en main:
  el main.yml viejo compila en front-kronos (A) como siempre.

  Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\bluegreen\revert-serfarma05.ps1 -WhatIf
#>
param(
  [string]$StateDir = 'C:\Users\administrador.DFARUNIADM\projects\front-kronos-bluegreen',
  [string]$LegacyFrontName = 'GSS-Front',
  [switch]$RemoveFolders,
  [switch]$WhatIf,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
. (Join-Path $PSScriptRoot 'mcp-dedicado.ps1')
$t0 = Get-Date
function Step([string]$m) { Write-Host ("[{0,6:N1}s] {1}" -f ((Get-Date) - $t0).TotalSeconds, $m) }

$cfg = Get-BgConfig $StateDir
$active = Get-BgActive $StateDir
$cA = Get-BgColor $cfg 'A'
$cB = Get-BgColor $cfg 'B'
$port = [int]$cfg.proxy.port
$instances = [int](Get-Opt $cfg 'front.instances' 2)
$mcpRoot = Get-Opt $cfg 'mcp.root' $null
$legacyFront = [ordered]@{
  name = $LegacyFrontName; cwd = $cA.dir; script = (Join-Path $cA.dir 'node_modules\next\dist\bin\next'); args = 'start'
  exec_mode = 'cluster'; instances = $instances; autorestart = $true; env = [ordered]@{ PORT = [string]$port }
}
$legacyMcp = New-McpAppAt $cfg $cA.dir

# ---- 0. prechecks (sin pm2)
$problemas = @()
try { Assert-Pm2Daemon $cfg } catch { $problemas += $_.Exception.Message }
foreach ($f in '.next\BUILD_ID', 'mcp\dist\server.js', 'app\generated\prisma\index.js') {
  if (-not (Test-Path (Join-Path $cA.dir $f))) { $problemas += "Falta $($cA.dir)\$f" }
}
$stampA = Read-JsonFile (Join-Path $cA.dir '.bluegreen-build.json')
$headA = (git -C $cA.dir rev-parse HEAD).Trim()
if ($stampA -and $stampA.sha -ne $headA) { $problemas += "A se esta reconstruyendo (HEAD $headA, sello $($stampA.sha)). Espere a que termine el deploy." }
if ($active.color -ne 'A') {
  $msg = "El activo es B ($($active.sha)); A tiene $(if ($stampA) { $stampA.sha } else { 'el build previo al azul/verde' }) y quedaria una version atras."
  if ($Force) { Write-Host "::warning::$msg (-Force)" } else { $problemas += "$msg Use switch.ps1 -Rollback o -Force." }
}
$mcpPid = 0
$mcpOnRoot = $false
$listen = Get-NetTCPConnection -State Listen -LocalPort ([int]$cfg.mcp.port) -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listen) {
  $mcpPid = [int]$listen.OwningProcess
  $pp = Get-CimInstance Win32_Process -Filter "ProcessId=$mcpPid"
  if ($mcpRoot -and $pp -and (Test-ProcTouchesDir $pp $mcpRoot)) { $mcpOnRoot = $true }
}
Step ("Activo {0} ({1}); A HEAD {2}; MCP pid {3} {4}" -f $active.color, $active.sha, $headA, $mcpPid, $(if ($mcpOnRoot) { "desde $mcpRoot" } else { 'desde la carpeta del front' }))

if ($WhatIf) {
  Write-Host ""
  Write-Host "WHATIF - plan (no se ejecuto nada):"
  Write-Host "  1. Respaldar active.json y bluegreen.json"
  Write-Host "  2. CORTE: pm2 delete $($cfg.proxy.name) -> esperar :$port libre -> pm2 start $LegacyFrontName (cluster x$instances, cwd $($cA.dir), PORT $port)"
  if ($mcpOnRoot) { Write-Host "  3. CORTE MCP: pm2 delete $($cfg.mcp.name) -> pm2 start desde $($cA.dir)\mcp -> /health" } else { Write-Host "  3. MCP: no corre desde la carpeta dedicada; no se toca" }
  Write-Host "  4. pm2 delete $($cA.name) $($cB.name); pm2 save"
  Write-Host "  5. Archivar $StateDir$(if ($RemoveFolders) { "; borrar worktree $($cB.dir) y $mcpRoot" })"
  if ($problemas.Count) { Write-Host ""; Write-Host "PROBLEMAS (la reversa real abortaria):"; $problemas | ForEach-Object { Write-Host "  - $_" }; exit 1 }
  exit 0
}
if ($problemas.Count) { $problemas | ForEach-Object { Write-Host "::error::$_" }; throw "Prechecks con problemas: no se toco nada." }

# ---- 1. respaldo del estado
$bk = "$StateDir.respaldo-$(Get-Date -Format yyyyMMddHHmmss)"
New-Item -ItemType Directory -Path $bk | Out-Null
Copy-Item (Join-Path $StateDir '*.json') $bk
Step "Estado respaldado en $bk"

# ---- 2. corte del front
Step "CORTE: quito $($cfg.proxy.name) de :$port y arranco $LegacyFrontName desde A"
$tGap = Get-Date
Remove-Pm2App $cfg.proxy.name
$ok = $false
try {
  Wait-PortFree $port $StateDir 15 $cfg
  Remove-Pm2App $LegacyFrontName
  Start-Pm2Declared $StateDir $legacyFront
  $ok = Wait-Healthy "http://127.0.0.1:$port" $null 180 (2 * $instances)
} catch { Write-Host "::error::$($_.Exception.Message)" }
$gap = ((Get-Date) - $tGap).TotalSeconds
if (-not $ok) {
  Write-Host "::error::$LegacyFrontName no respondio en :$port. Vuelvo a poner el proxy (azul/verde intacto)."
  Remove-Pm2App $LegacyFrontName
  try { Wait-PortFree $port $cA.dir 30 $cfg } catch { Write-Host "::warning::$($_.Exception.Message)" }
  Start-Pm2Declared $StateDir ([ordered]@{
    name = $cfg.proxy.name; cwd = $StateDir; script = (Join-Path $StateDir 'proxy.cjs')
    args = "--listen $port --state $StateDir --label produccion"
    interpreter = $cfg.node; exec_mode = 'fork'; instances = 1; autorestart = $true; max_memory_restart = '512M'
  })
  [void](Invoke-Pm2 save)
  throw ("Reversa abortada (hueco {0:N1} s); el proxy volvio a :$port." -f $gap)
}
Step ("{0} en :{1} -> 200; hueco {2:N1} s" -f $LegacyFrontName, $port, $gap)

# ---- 3. MCP
if ($mcpOnRoot) {
  Step "CORTE MCP: $($cfg.mcp.name) de $mcpRoot a $($cA.dir)\mcp"
  $tMcp = Get-Date
  Remove-Pm2App $cfg.mcp.name
  $mok = $false
  try {
    Wait-PortFree ([int]$cfg.mcp.port) $mcpRoot 15 $cfg
    Start-Pm2Declared $StateDir $legacyMcp
    $mok = Wait-McpHealthy $cfg 60
  } catch { Write-Host "::error::$($_.Exception.Message)" }
  if (-not $mok) {
    Write-Host "::warning::El MCP no respondio desde A; vuelve a $mcpRoot."
    Remove-Pm2App $cfg.mcp.name
    try { Wait-PortFree ([int]$cfg.mcp.port) $cA.dir 15 $cfg } catch { Write-Host "::warning::$($_.Exception.Message)" }
    Start-Pm2Declared $StateDir (New-McpAppAt $cfg $mcpRoot)
    [void](Wait-McpHealthy $cfg 60)
    $RemoveFolders = $false
  } else {
    Step ("MCP en linea desde A; hueco {0:N1} s" -f ((Get-Date) - $tMcp).TotalSeconds)
  }
}

# ---- 4. limpieza pm2
Remove-Pm2App $cA.name
Remove-Pm2App $cB.name
[void](Invoke-Pm2 save)

# ---- 5. archivo de estado y carpetas
$dest = "$StateDir.revertido-$(Get-Date -Format yyyyMMddHHmmss)"
Rename-Item -LiteralPath $StateDir -NewName (Split-Path $dest -Leaf)
Step "Estado archivado en $dest"
if ($RemoveFolders) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  if ($cB.dir -ne $cA.dir -and (Get-NodeProcsInDir $cB.dir).Count -eq 0) {
    git -C $cA.dir worktree remove --force $cB.dir 2>&1 | Out-Host
    Step "Worktree B eliminado ($($cB.dir))"
  }
  foreach ($d in @($mcpRoot, "$mcpRoot.anterior", "$mcpRoot.nuevo")) {
    if ($d -and (Test-Path -LiteralPath $d) -and (Get-NodeProcsInDir $d).Count -eq 0) { Remove-Item -LiteralPath $d -Recurse -Force; Step "Borrada $d" }
  }
  $ErrorActionPreference = $prev
}
Step 'REVERSA COMPLETA. Falta revertir el PR del workflow en main.'
