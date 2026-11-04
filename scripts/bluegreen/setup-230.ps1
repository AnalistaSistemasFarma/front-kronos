<#
.SYNOPSIS
  Activacion UNICA del despliegue azul/verde en la .230 (entorno de PRUEBAS).
  Reversa: scripts\bluegreen\revert-230.ps1.

.DESCRIPTION
  Modo "migrate" (el real; correr ANTES de fusionar a testing el workflow nuevo):
    - Color A = la carpeta actual front-kronos-test (no se mueve ni se copia).
    - Color B = un git worktree nuevo (front-kronos-test-b), con enlaces
      simbolicos a .env, mcp\.env y dbconfig.js de A (no se copian secretos).
    - Arranca GSS-Front-TEST-A en :3032 con el build que ya esta en A y
      comprueba que sirve el mismo buildId que hoy sirve :3030.
    - Cambio unico: pm2 delete GSS-Front-TEST (libera :3030) y arranca
      GSS-Front-TEST-proxy en :3030 apuntando a A. Hueco de pocos segundos
      (se mide e imprime). El tunel cf-kronos-test y el IIS no se tocan.
    - kronos-mcp-test sigue igual (corre desde A, que es el color activo).
    - pm2 save.
  Modo "fresh" (ensayo aislado): crea A y B como worktrees nuevos, deja el proxy
  en otro puerto y no toca nada del entorno real. Usar con -NoMcp.

  Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\bluegreen\setup-230.ps1
#>
param(
  [ValidateSet('migrate', 'fresh')][string]$Mode = 'migrate',
  [string]$StateDir = 'C:\Users\nicolas.rivera\projects\front-kronos-test-bluegreen',
  [string]$RepoDir = 'C:\Users\nicolas.rivera\projects\front-kronos-test',
  [string]$ADir = 'C:\Users\nicolas.rivera\projects\front-kronos-test',
  [string]$BDir = 'C:\Users\nicolas.rivera\projects\front-kronos-test-b',
  [int]$ProxyPort = 3030,
  [int]$APort = 3032,
  [int]$BPort = 3033,
  [string]$NamePrefix = 'GSS-Front-TEST',
  [string]$LegacyFrontName = 'GSS-Front-TEST',
  [string]$McpName = 'kronos-mcp-test',
  [int]$McpPort = 3031,
  [switch]$NoMcp,
  [string]$NodeExe = 'C:\nvm4w\nodejs\node.exe',
  [string]$ExtraEnvJson = '{}',
  [int]$DrainSeconds = 20,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
$t0 = Get-Date
function Step([string]$m) { Write-Host ("[{0,6:N1}s] {1}" -f ((Get-Date) - $t0).TotalSeconds, $m) }

if ((Test-Path (Join-Path $StateDir 'active.json')) -and -not $Force) {
  throw "Ya existe $StateDir\active.json: el azul/verde ya esta activado. Use -Force solo si sabe lo que hace."
}
if (-not (Test-Path (Join-Path $RepoDir '.git'))) { throw "No es un repo git: $RepoDir" }
foreach ($p in $APort, $BPort) {
  if ((Get-PortOwners $p).Count -gt 0) { throw "El puerto $p ya esta en uso; elija otro (-APort/-BPort)." }
}

function New-Worktree([string]$Dir) {
  if (Test-Path -LiteralPath $Dir) { Step "Ya existe $Dir (se reutiliza)"; return }
  Step "git worktree add --detach $Dir"
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  git -C $RepoDir worktree add --detach $Dir HEAD 2>&1 | Out-Host
  $rc = $LASTEXITCODE; $ErrorActionPreference = $prev
  if ($rc -ne 0) { throw "git worktree add fallo para $Dir" }
}

if ($Mode -eq 'fresh') { New-Worktree $ADir }
New-Worktree $BDir

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$cfg = [ordered]@{
  proxy  = [ordered]@{ name = "$NamePrefix-proxy"; port = $ProxyPort }
  colors = [ordered]@{
    A = [ordered]@{ dir = $ADir; port = $APort; name = "$NamePrefix-A" }
    B = [ordered]@{ dir = $BDir; port = $BPort; name = "$NamePrefix-B" }
  }
  mcp    = [ordered]@{ enabled = (-not $NoMcp); name = $McpName; port = $McpPort }
  node   = $NodeExe
  linkFrom = $RepoDir
  links  = @('.env', 'mcp\.env', 'dbconfig.js', 'mcp\kronos-mcp-test-audit.log')
  extraEnv = ($ExtraEnvJson | ConvertFrom-Json)
  drainSeconds = $DrainSeconds
}
Write-JsonFile (Join-Path $StateDir 'bluegreen.json') $cfg
Copy-Item (Join-Path $PSScriptRoot 'proxy.cjs') (Join-Path $StateDir 'proxy.cjs') -Force
$cfg = Get-BgConfig $StateDir
Step "Configuracion escrita en $StateDir\bluegreen.json"

$proxyApp = [ordered]@{
  name = $cfg.proxy.name; cwd = $StateDir; script = (Join-Path $StateDir 'proxy.cjs')
  args = "--listen $ProxyPort --state $StateDir"
  interpreter = $NodeExe; exec_mode = 'fork'; instances = 1; autorestart = $true
  max_memory_restart = '300M'
}

if ($Mode -eq 'fresh') {
  Set-BgActive $StateDir 'A' $APort 'ninguno'
  Remove-Pm2App $cfg.proxy.name
  Start-Pm2Declared $StateDir $proxyApp
  [void](Invoke-Pm2 save)
  Step "Ensayo listo: proxy :$ProxyPort -> A (sin build todavia). El primer deploy construye B."
  exit 0
}

# ---------------- migrate
if (-not (Test-Path (Join-Path $ADir '.next\BUILD_ID'))) { throw "A no tiene build (.next\BUILD_ID)." }
$shaA = (git -C $ADir rev-parse HEAD).Trim()
$bidNow = Get-BuildIdAt "http://127.0.0.1:$ProxyPort"
Step "Hoy :$ProxyPort sirve buildId $bidNow (HEAD de A $shaA)"

Step "Arranco $($cfg.colors.A.name) en :$APort desde $ADir (mismo build)"
Remove-Pm2App $cfg.colors.A.name
Start-Pm2Declared $StateDir (New-FrontApp $cfg 'A')
$expect = if ($bidNow) { $bidNow } else { $null }
if (-not (Wait-Healthy "http://127.0.0.1:$APort" $expect 150)) {
  Remove-Pm2App $cfg.colors.A.name
  throw "A en :$APort no respondio 200 con el buildId actual. No se cambio nada del entorno."
}
Set-BgActive $StateDir 'A' $APort $shaA

Step "Cambio unico: $LegacyFrontName fuera de :$ProxyPort, proxy dentro"
$tGap = Get-Date
Remove-Pm2App $LegacyFrontName
Wait-PortFree $ProxyPort $ADir 20
Start-Pm2Declared $StateDir $proxyApp
$ok = Wait-Healthy "http://127.0.0.1:$ProxyPort" $expect 60
$gap = ((Get-Date) - $tGap).TotalSeconds
if (-not $ok) {
  Write-Host "::error::El proxy no respondio; se restaura $LegacyFrontName."
  Remove-Pm2App $cfg.proxy.name
  Wait-PortFree $ProxyPort $StateDir 15
  [void](Invoke-Pm2 start (Join-Path $ADir 'ecosystem-test.config.js') --only $LegacyFrontName)
  Remove-Pm2App $cfg.colors.A.name
  [void](Invoke-Pm2 save)
  throw "Activacion revertida."
}
[void](Invoke-Pm2 save)
Step ("ACTIVADO. Hueco del cambio unico: {0:N1} s. :$ProxyPort -> A (:$APort). B ($BDir) se construira en el primer deploy." -f $gap)
