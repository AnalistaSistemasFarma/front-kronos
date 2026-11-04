<#
.SYNOPSIS
  Activacion UNICA del despliegue azul/verde de PRODUCCION (serfarma05).
  Reversa: scripts\bluegreen\revert-serfarma05.ps1.

.DESCRIPTION
  Se corre por SSH como administrador, en la ventana autorizada, ANTES de
  fusionar a main el workflow nuevo (desde un worktree temporal de la rama).
  Con -WhatIf solo LEE (procesos, puertos, disco, RAM, HTTP, git) e imprime el
  plan: no llama a pm2, no crea carpetas, no escribe nada.

  Prechecks (siempre, sin pm2):
    - el daemon de pm2 es el del servicio 0pm2.exe (uno solo, sin Daemon.js
      manual): si no, aborta sin llamar a pm2 (incidente 2026-10-28);
    - checkout A limpio, con .next\BUILD_ID, mcp\dist y cliente Prisma;
    - puertos de los colores libres; RAM y disco suficientes;
    - :3003 y :3020 responden; anota el buildId vigente.

  Acciones:
    1. Color A = la carpeta actual front-kronos (no se mueve ni se copia).
       Color B = git worktree nuevo front-kronos-b (se construye en el primer
       deploy; hasta entonces no corre nada ahi).
    2. Escribe <estado>\bluegreen.json y copia proxy.cjs a <estado>.
    3. Arma la carpeta dedicada del MCP (<mcp.root>.nuevo) copiando mcp\ y el
       cliente Prisma de A, con enlaces a los .env; prueba que carga. Sin hueco.
    4. Arranca GSS-Front-A (cluster x2) en :3041 con el MISMO build de A y
       comprueba que sirve el mismo buildId que hoy sirve :3003. Sin hueco.
    5. CORTE UNICO del front: pm2 delete GSS-Front (libera :3003) y arranca
       GSS-Front-proxy en :3003 -> A. Hueco de pocos segundos (se mide). IIS,
       agentes y uptime-kuma siguen apuntando a :3003. Si el proxy no responde,
       se restaura GSS-Front tal como estaba (cluster x2 en :3003).
    6. CORTE del MCP (salvo -SkipMcp): kronos-mcp pasa de front-kronos\mcp a la
       carpeta dedicada (delete + start, nunca 2 instancias; segundos). Si no
       responde /health, vuelve a front-kronos\mcp.
    7. pm2 save.

  Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\bluegreen\setup-serfarma05.ps1 -WhatIf
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\bluegreen\setup-serfarma05.ps1
#>
param(
  [string]$Projects = 'C:\Users\administrador.DFARUNIADM\projects',
  [string]$StateDir = '',
  [string]$ADir = '',
  [string]$BDir = '',
  [string]$McpRoot = '',
  [int]$ProxyPort = 3003,
  [int]$APort = 3041,
  [int]$BPort = 3042,
  [string]$NamePrefix = 'GSS-Front',
  [string]$LegacyFrontName = 'GSS-Front',
  [int]$Instances = 2,
  [string]$McpName = 'kronos-mcp',
  [int]$McpPort = 3020,
  [string]$NodeExe = 'C:\Program Files\nodejs\node.exe',
  [string]$Pm2Home = 'C:\Users\administrador.DFARUNIADM\.pm2',
  [string]$Pm2Cmd = 'C:\Users\administrador.DFARUNIADM\AppData\Roaming\npm\pm2.cmd',
  [string]$Pm2Service = '0pm2.exe',
  [int]$DrainSeconds = 45,
  [int]$MinFreeMbBuild = 3000,
  [int]$MinFreeMbSwitch = 2000,
  [int]$MinFreeMbSetup = 2500,
  [int]$MinFreeDiskGb = 15,
  [switch]$SkipMcp,
  [switch]$WhatIf,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
. (Join-Path $PSScriptRoot 'mcp-dedicado.ps1')
$t0 = Get-Date
function Step([string]$m) { Write-Host ("[{0,6:N1}s] {1}" -f ((Get-Date) - $t0).TotalSeconds, $m) }
if (-not $StateDir) { $StateDir = Join-Path $Projects 'front-kronos-bluegreen' }
if (-not $ADir) { $ADir = Join-Path $Projects 'front-kronos' }
if (-not $BDir) { $BDir = Join-Path $Projects 'front-kronos-b' }
if (-not $McpRoot) { $McpRoot = Join-Path $Projects 'front-kronos-mcp' }

# Configuracion completa (se escribe en el paso 2; antes sirve para los prechecks).
$cfgObj = [ordered]@{
  proxy  = [ordered]@{ name = "$NamePrefix-proxy"; port = $ProxyPort }
  colors = [ordered]@{
    A = [ordered]@{ dir = $ADir; port = $APort; name = "$NamePrefix-A" }
    B = [ordered]@{ dir = $BDir; port = $BPort; name = "$NamePrefix-B" }
  }
  front  = [ordered]@{ execMode = 'cluster'; instances = $Instances }
  mcp    = [ordered]@{
    enabled = $true; name = $McpName; port = $McpPort; mode = 'dedicated'; root = $McpRoot
    # .env (solo CORREO_*) y mcp\.env se ENLAZAN a A; el log de auditoria sigue siendo uno solo.
    links = @('.env', 'mcp\.env', 'mcp\kronos-mcp-audit.log')
  }
  node   = $NodeExe
  linkFrom = $ADir
  # B: .env enlazados a A; dbconfig.js COPIADO (Turbopack no resuelve modulos
  # enlazados fuera del proyecto).
  links  = @('.env', 'mcp\.env')
  copies = @('dbconfig.js')
  extraEnv = [ordered]@{}
  drainSeconds = $DrainSeconds
  pm2    = [ordered]@{ home = $Pm2Home; cmd = $Pm2Cmd; service = $Pm2Service }
  guards = [ordered]@{ minFreeMbBuild = $MinFreeMbBuild; minFreeMbSwitch = $MinFreeMbSwitch }
  build  = [ordered]@{ voiceMigration = $false; cleanOrphans = $true }
  smoke  = @(
    [ordered]@{ path = '/login'; expect = @(200) },
    [ordered]@{ path = '/api/health/version'; expect = @(200) },
    [ordered]@{ path = '/api/health/database'; expect = @(401, 403) }
  )
}
$cfg = ($cfgObj | ConvertTo-Json -Depth 8 | ConvertFrom-Json)
Set-Pm2Context $cfg

# Declaraciones "como estaba" (para la vuelta atras dentro de este script).
$legacyFront = [ordered]@{
  name = $LegacyFrontName; cwd = $ADir; script = (Join-Path $ADir 'node_modules\next\dist\bin\next'); args = 'start'
  exec_mode = 'cluster'; instances = $Instances; autorestart = $true; env = [ordered]@{ PORT = [string]$ProxyPort }
}
$legacyMcp = New-McpAppAt $cfg $ADir

# ------------------------------------------------------------------ PRECHECKS (solo lectura)
$problemas = @()
Step "Prechecks en solo lectura (sin pm2)"
try { Assert-Pm2Daemon $cfg; Step "OK: un solo daemon de pm2 y es el del servicio $Pm2Service" } catch { $problemas += $_.Exception.Message }
if ((Test-Path (Join-Path $StateDir 'active.json')) -and -not $Force) { $problemas += "Ya existe $StateDir\active.json: el azul/verde ya esta activado." }
if (-not (Test-Path (Join-Path $ADir '.git'))) { $problemas += "No es un repo git: $ADir" }
$shaA = (git -C $ADir rev-parse HEAD).Trim()
$dirty = @(git -C $ADir status --porcelain --untracked-files=no)
if ($dirty.Count -gt 0) { $problemas += "A tiene cambios en archivos versionados: $($dirty -join ' | ')" }
foreach ($f in '.next\BUILD_ID', 'mcp\dist\server.js', 'mcp\serve.mjs', 'app\generated\prisma\index.js', '.env', 'mcp\.env', 'dbconfig.js') {
  if (-not (Test-Path (Join-Path $ADir $f))) { $problemas += "Falta $ADir\$f" }
}
foreach ($p in @($APort, $BPort)) { if ((Get-PortOwners $p).Count -gt 0) { $problemas += "El puerto $p ya esta en uso." } }
if ((Test-Path $BDir) -and -not $Force) { $problemas += "Ya existe $BDir" }
if ((Test-Path $McpRoot) -or (Test-Path "$McpRoot.nuevo")) { if (-not $Force) { $problemas += "Ya existe $McpRoot o $McpRoot.nuevo" } }
$free = Get-FreeRamMb
if ($free -lt $MinFreeMbSetup) { $problemas += "RAM libre $free MB < $MinFreeMbSetup MB" }
$disk = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
if ($disk -lt $MinFreeDiskGb) { $problemas += "Disco C: libre $disk GB < $MinFreeDiskGb GB" }
$bidNow = Get-BuildIdAt "http://127.0.0.1:$ProxyPort"
if (-not $bidNow) { $problemas += ":$ProxyPort/api/health/version no responde" }
$mcpNow = Get-HttpStatus "http://127.0.0.1:$McpPort/health" 10
if ($mcpNow -ne 200) { $problemas += ":$McpPort/health -> $mcpNow" }
$owner = (Get-Acl $ADir).Owner
$flag = Test-Path 'C:\inetpub\wwwroot\GSS\mantenimiento.flag'
Step ("A={0} HEAD {1}; buildId vigente {2}; MCP {3}; RAM libre {4} MB; disco C {5} GB; duenio de A {6}; bandera mantenimiento {7}" -f $ADir, $shaA, $bidNow, $mcpNow, $free, $disk, $owner, $flag)

if ($WhatIf) {
  Write-Host ""
  Write-Host "WHATIF - plan (no se ejecuto nada):"
  Write-Host "  1. git worktree add --detach $BDir $shaA"
  Write-Host "  2. Escribir $StateDir\bluegreen.json (colores A :$APort / B :$BPort, cluster x$Instances, MCP dedicado en $McpRoot) y copiar proxy.cjs"
  Write-Host "  3. Armar $McpRoot.nuevo desde $ADir (mcp\ + app\generated\prisma + @prisma\client; enlaces a .env, mcp\.env y log) y probar carga"
  Write-Host "  4. pm2 start $NamePrefix-A (:$APort, cluster x$Instances, cwd $ADir) y esperar buildId $bidNow"
  Write-Host "  5. CORTE: pm2 delete $LegacyFrontName -> esperar :$ProxyPort libre -> pm2 start $NamePrefix-proxy (:$ProxyPort -> A)"
  if ($SkipMcp) { Write-Host "  6. (omitido por -SkipMcp: el MCP pasa a la carpeta dedicada en el primer deploy)" }
  else { Write-Host "  6. CORTE MCP: pm2 delete $McpName -> renombrar $McpRoot.nuevo -> $McpRoot -> pm2 start $McpName (cwd $McpRoot\mcp) -> /health" }
  Write-Host "  7. pm2 save"
  if ($problemas.Count) { Write-Host ""; Write-Host "PROBLEMAS (la activacion real abortaria):"; $problemas | ForEach-Object { Write-Host "  - $_" }; exit 1 }
  Write-Host ""; Write-Host "Prechecks OK."
  exit 0
}
if ($problemas.Count) { $problemas | ForEach-Object { Write-Host "::error::$_" }; throw "Prechecks con problemas: no se toco nada." }

# ------------------------------------------------------------------ 1-2. B y estado
if (-not (Test-Path $BDir)) {
  Step "git worktree add --detach $BDir $shaA"
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  git -C $ADir worktree add --detach $BDir $shaA 2>&1 | Out-Host
  $rc = $LASTEXITCODE; $ErrorActionPreference = $prev
  if ($rc -ne 0) { throw "git worktree add fallo para $BDir" }
}
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
Write-JsonFile (Join-Path $StateDir 'bluegreen.json') $cfgObj
Copy-Item (Join-Path $PSScriptRoot 'proxy.cjs') (Join-Path $StateDir 'proxy.cjs') -Force
$cfg = Get-BgConfig $StateDir
Step "Configuracion escrita en $StateDir\bluegreen.json"

# ------------------------------------------------------------------ 3. MCP dedicado (sin hueco)
$stg = $null
if (-not $SkipMcp) {
  Step "Armo la carpeta dedicada del MCP desde $ADir (sin detener nada)"
  $stg = New-McpStaging $cfg $ADir $shaA
}

# ------------------------------------------------------------------ 4. color A en paralelo (sin hueco)
Assert-FreeRam $MinFreeMbSetup "levantar $NamePrefix-A junto a $LegacyFrontName"
Step "Arranco $($cfg.colors.A.name) en :$APort desde $ADir (mismo build, cluster x$Instances)"
Remove-Pm2App $cfg.colors.A.name
Start-Pm2Declared $StateDir (New-FrontApp $cfg 'A')
if (-not (Wait-Healthy "http://127.0.0.1:$APort" $bidNow 180 (2 * $Instances))) {
  Remove-Pm2App $cfg.colors.A.name
  [void](Invoke-Pm2 save)
  throw "A en :$APort no respondio 200 con el buildId $bidNow. No se cambio nada del servicio (GSS-Front sigue en :$ProxyPort)."
}
Set-BgActive $StateDir 'A' $APort $shaA

# ------------------------------------------------------------------ 5. corte unico del front
$proxyApp = [ordered]@{
  name = $cfg.proxy.name; cwd = $StateDir; script = (Join-Path $StateDir 'proxy.cjs')
  args = "--listen $ProxyPort --state $StateDir --label produccion"
  interpreter = $NodeExe; exec_mode = 'fork'; instances = 1; autorestart = $true
  max_memory_restart = '512M'
}
Step "CORTE UNICO: $LegacyFrontName fuera de :$ProxyPort, proxy dentro"
$tGap = Get-Date
Remove-Pm2App $LegacyFrontName
$ok = $false
try {
  Wait-PortFree $ProxyPort $ADir 30 $cfg
  Start-Pm2Declared $StateDir $proxyApp
  $ok = Wait-Healthy "http://127.0.0.1:$ProxyPort" $bidNow 60
} catch { Write-Host "::error::$($_.Exception.Message)" }
$gap = ((Get-Date) - $tGap).TotalSeconds
if (-not $ok) {
  Write-Host "::error::El proxy no respondio; se restaura $LegacyFrontName como estaba."
  Remove-Pm2App $cfg.proxy.name
  try { Wait-PortFree $ProxyPort $StateDir 15 $cfg } catch { Write-Host "::warning::$($_.Exception.Message)" }
  Start-Pm2Declared $StateDir $legacyFront
  $back = Wait-Healthy "http://127.0.0.1:$ProxyPort" $bidNow 180
  Remove-Pm2App $cfg.colors.A.name
  [void](Invoke-Pm2 save)
  Rename-Item -LiteralPath $StateDir -NewName ((Split-Path $StateDir -Leaf) + '.fallido-' + (Get-Date -Format yyyyMMddHHmmss))
  throw ("Activacion revertida (hueco {0:N1} s). {1} {2}" -f $gap, $LegacyFrontName, $(if ($back) { 'responde de nuevo.' } else { 'NO responde: revisar ya.' }))
}
[void](Invoke-Pm2 save)
Step ("Front ACTIVADO. Hueco del corte unico: {0:N1} s. :$ProxyPort -> A (:$APort)." -f $gap)

# ------------------------------------------------------------------ 6. MCP a su carpeta
if ($stg) {
  Step "CORTE MCP: $McpName a $McpRoot (delete + start, nunca 2 instancias)"
  $res = Switch-McpDedicated $cfg $StateDir $stg $legacyMcp
  if ($res.ok) { Step $res.message } else { Write-Host "::warning::$($res.message)" }
} else {
  Step "MCP sin cambios (-SkipMcp): sigue en $ADir\mcp; el primer deploy lo pasa a $McpRoot."
}
[void](Invoke-Pm2 save)
Step "LISTO. B ($BDir) se construye en el primer deploy de main. Siguiente: verificacion del RUNBOOK."
