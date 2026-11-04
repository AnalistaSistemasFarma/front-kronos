<#
.SYNOPSIS
  Construye la carpeta del color INACTIVO del entorno de PRUEBAS (.230) sin
  tocar el color que esta atendiendo.

.DESCRIPTION
  Lo llama .github/workflows/deploy-testing.yml (job "build") DESPUES de dejar
  el codigo de la carpeta inactiva en el commit a desplegar. Nada corre desde
  esta carpeta, asi que no hay binarios nativos bloqueados ni hace falta
  detener pm2:
    1. borra el sello de build (si este build se cancela, switch.ps1 no activa
       una carpeta a medio construir);
    2. enlaza los archivos con secretos (.env, mcp\.env, dbconfig.js) desde la
       carpeta canonica (symlink; nunca se copian ni se imprimen);
    3. npm install del front y del MCP solo si cambiaron package.json o
       package-lock.json desde la ultima instalacion en ESTA carpeta;
    4. prisma generate, migracion aditiva, next build (con un reintento),
       build del MCP;
    5. escribe el sello .bluegreen-build.json con sha y run id.

  Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.
#>
param(
  [Parameter(Mandatory = $true)][string]$StateDir,
  [Parameter(Mandatory = $true)][string]$Color,
  [Parameter(Mandatory = $true)][string]$Sha,
  [string]$RunId = 'manual'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')

$cfg = Get-BgConfig $StateDir
$active = Get-BgActive $StateDir
if ($active.color -eq $Color) { throw "El color $Color esta ACTIVO; no se construye encima de la version que atiende." }
$c = Get-BgColor $cfg $Color
$dir = $c.dir
$stamp = Join-Path $dir '.bluegreen-build.json'
$t0 = Get-Date
function Step([string]$m) { Write-Host ("[{0,6:N1}s] {1}" -f ((Get-Date) - $t0).TotalSeconds, $m) }

if (Test-Path -LiteralPath $stamp) { Remove-Item -LiteralPath $stamp -Force }

# Procesos node vivos dentro de la carpeta (no deberia haber ninguno): solo se avisa.
$vivos = Get-NodeProcsInDir $dir
foreach ($p in $vivos) { Write-Host "::warning::node vivo en la carpeta inactiva: PID $($p.ProcessId) $($p.CommandLine)" }

# ---- enlaces a los archivos con secretos (fuente unica: carpeta canonica)
if ($cfg.linkFrom -and ($cfg.linkFrom.TrimEnd('\') -ne $dir.TrimEnd('\'))) {
  foreach ($rel in $cfg.links) {
    $src = Join-Path $cfg.linkFrom $rel
    $dst = Join-Path $dir $rel
    if (-not (Test-Path -LiteralPath $src)) { Write-Host "::warning::No existe $src; no se enlaza $rel"; continue }
    $item = Get-Item -LiteralPath $dst -Force -ErrorAction SilentlyContinue
    if ($item -and $item.LinkType -eq 'SymbolicLink' -and (@($item.Target)[0] -eq $src)) { continue }
    if ($item) { Remove-Item -LiteralPath $dst -Force }
    $parent = Split-Path $dst -Parent
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    New-Item -ItemType SymbolicLink -Path $dst -Target $src | Out-Null
    Write-Host "Enlace $rel -> $src"
  }
}
if (-not (Test-Path (Join-Path $dir '.env'))) { throw "FALTA .env en $dir" }
if ($cfg.mcp.enabled -and -not (Test-Path (Join-Path $dir 'mcp\.env'))) { throw "FALTA mcp\.env en $dir" }

function Get-DepsHash([string]$Folder) {
  $h = ''
  foreach ($f in 'package.json', 'package-lock.json') {
    $p = Join-Path $Folder $f
    if (Test-Path -LiteralPath $p) { $h += (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }
  }
  return $h
}

function Install-IfChanged([string]$Folder, [string]$Label) {
  # El sello vive DENTRO de node_modules: si se borra node_modules, se reinstala.
  $mark = Join-Path $Folder 'node_modules\.bluegreen-deps.sha'
  $want = Get-DepsHash $Folder
  $have = if (Test-Path -LiteralPath $mark) { (Get-Content -LiteralPath $mark -Raw).Trim() } else { '' }
  if ($have -eq $want) { Step "npm install ($Label): dependencias sin cambios, se reutiliza node_modules"; return }
  Step "npm install ($Label)..."
  Push-Location $Folder
  try {
    npm install --prefer-offline --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install ($Label) fallo" }
    # npm install puede reescribir el lock; se devuelve al del commit para que
    # git quede limpio y el hash coincida con el del repo.
    $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    git checkout -- package-lock.json 2>&1 | Out-Null
    $ErrorActionPreference = $prevEap
  } finally { Pop-Location }
  [IO.File]::WriteAllText($mark, (Get-DepsHash $Folder))
  Step "npm install ($Label) listo"
}

Push-Location $dir
try {
  Install-IfChanged $dir 'front'

  Step 'prisma generate...'
  npx prisma generate
  if ($LASTEXITCODE -ne 0) { throw 'prisma generate fallo' }

  Step 'migracion aditiva de estado compartido de voz...'
  npx prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260921193000_chat_voice_shared_state/migration.sql
  if ($LASTEXITCODE -ne 0) { throw 'migracion de voz fallo' }

  Step 'next build...'
  $env:GITHUB_SHA = $Sha
  npm run build
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'fallo el primer intento de build; espero y reintento una vez'
    Start-Sleep -Seconds 5
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'npm run build (front) fallo tras reintento' }
  }
  if (-not (Test-Path '.next\BUILD_ID')) { throw 'No quedo .next\BUILD_ID' }
  Step 'next build listo'

  if ($cfg.mcp.enabled) {
    Install-IfChanged (Join-Path $dir 'mcp') 'mcp'
    Step 'build MCP...'
    Push-Location (Join-Path $dir 'mcp')
    try {
      npm run build
      if ($LASTEXITCODE -ne 0) { throw 'npm run build (mcp) fallo' }
    } finally { Pop-Location }
  }
} finally { Pop-Location }

Write-JsonFile $stamp ([ordered]@{ color = $Color; sha = $Sha; runId = [string]$RunId; builtAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz') })
Step "BUILD OK en $dir (color $Color, sha $Sha). La version activa ($($active.color)) siguio atendiendo todo el tiempo."
