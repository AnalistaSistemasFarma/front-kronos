<#
.SYNOPSIS
  REVERSA del azul/verde en la .230: vuelve al esquema de siempre
  (GSS-Front-TEST en :3030 y kronos-mcp-test desde front-kronos-test).

.DESCRIPTION
  1. Quita el proxy de :3030 y arranca GSS-Front-TEST con ecosystem-test.config.js
     de la carpeta A (front-kronos-test). Hueco de pocos segundos.
  2. Si kronos-mcp-test corre desde B, lo mueve a A (delete + start).
  3. Borra de pm2 GSS-Front-TEST-A / -B; pm2 save.
  4. Renombra la carpeta de estado a *.revertido-<fecha> (no borra nada).
  5. Con -RemoveWorktree, elimina el worktree B (git worktree remove).

  OJO: A sirve el ultimo build que se hizo EN A. Si el activo era B, A queda una
  version atras: revierta tambien el workflow (PR) y relance "Deploy a PRUEBAS"
  (workflow_dispatch) para reconstruir A con el esquema anterior.

  Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.
#>
param(
  [string]$StateDir = 'C:\Users\nicolas.rivera\projects\front-kronos-test-bluegreen',
  [string]$LegacyFrontName = 'GSS-Front-TEST',
  [switch]$RemoveWorktree
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
$t0 = Get-Date
function Step([string]$m) { Write-Host ("[{0,6:N1}s] {1}" -f ((Get-Date) - $t0).TotalSeconds, $m) }

$cfg = Get-BgConfig $StateDir
$active = Get-BgActive $StateDir
$cA = Get-BgColor $cfg 'A'
$cB = Get-BgColor $cfg 'B'
$eco = Join-Path $cA.dir 'ecosystem-test.config.js'
if (-not (Test-Path $eco)) { throw "No existe $eco" }
$stampA = Read-JsonFile (Join-Path $cA.dir '.bluegreen-build.json')
if ($active.color -ne 'A') {
  Write-Host "::warning::El color activo es B ($($active.sha)). A tiene el build $(if ($stampA) { $stampA.sha } else { 'previo al azul/verde' }): queda una version atras hasta el proximo deploy."
}

Step "Quito el proxy de :$($cfg.proxy.port) y arranco $LegacyFrontName desde A"
$tGap = Get-Date
Remove-Pm2App $cfg.proxy.name
Wait-PortFree ([int]$cfg.proxy.port) $StateDir 15
Remove-Pm2App $LegacyFrontName
$rc = Invoke-Pm2 start $eco --only $LegacyFrontName
if ($rc -ne 0) { throw "pm2 start $LegacyFrontName fallo" }
$ok = Wait-Healthy "http://127.0.0.1:$($cfg.proxy.port)" $null 150
Step ("{0}: :{1} -> HTTP {2}; hueco {3:N1} s" -f $LegacyFrontName, $cfg.proxy.port, $(if ($ok) { 200 } else { 'sin 200' }), ((Get-Date) - $tGap).TotalSeconds)

if ($cfg.mcp.enabled) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $mcpPid = [int]((& pm2 pid $cfg.mcp.name 2>$null) -join '').Trim()
  $ErrorActionPreference = $prev
  $mcpCmd = if ($mcpPid -gt 0) { [string](Get-CimInstance Win32_Process -Filter "ProcessId=$mcpPid").CommandLine } else { '' }
  if ($mcpCmd -like ('*' + $cB.dir.TrimEnd('\') + '\*')) {
    Step "Muevo $($cfg.mcp.name) de B a A"
    Remove-Pm2App $cfg.mcp.name
    Wait-PortFree ([int]$cfg.mcp.port) $cB.dir 15
    [void](Invoke-Pm2 start $eco --only $cfg.mcp.name)
    if (-not (Wait-PortListening ([int]$cfg.mcp.port) 40)) { Write-Host "::error::$($cfg.mcp.name) no abrio :$($cfg.mcp.port)" }
  } else {
    Step "$($cfg.mcp.name) no corre desde B; se deja como esta"
  }
}

Remove-Pm2App $cA.name
Remove-Pm2App $cB.name
[void](Invoke-Pm2 save)

$dest = "$StateDir.revertido-$(Get-Date -Format yyyyMMddHHmmss)"
Rename-Item -LiteralPath $StateDir -NewName (Split-Path $dest -Leaf)
Step "Estado archivado en $dest"

if ($RemoveWorktree -and ($cB.dir -ne $cA.dir)) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  git -C $cA.dir worktree remove --force $cB.dir 2>&1 | Out-Host
  $ErrorActionPreference = $prev
  Step "Worktree B eliminado ($($cB.dir))"
}
Step 'REVERSA COMPLETA.'
