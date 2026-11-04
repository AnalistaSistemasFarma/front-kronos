# Funciones comunes del despliegue azul/verde de PRUEBAS (.230).
# Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.
#
# Estado (carpeta de estado, por defecto
# C:\Users\nicolas.rivera\projects\front-kronos-test-bluegreen):
#   bluegreen.json  configuracion fija (colores, puertos, nombres pm2, MCP)
#   active.json     color activo {color, port, sha, since}; lo lee proxy.cjs
#   proxy.cjs       copia estable del proxy (no vive en una carpeta de release)
#   pm2-*.json      declaraciones pm2 generadas para cada arranque

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return ([IO.File]::ReadAllText($Path) -replace '^\uFEFF', '') | ConvertFrom-Json
}

function Write-JsonFile([string]$Path, $Object) {
  # UTF-8 sin BOM (JSON.parse de Node no acepta BOM) y reemplazo casi atomico.
  $json = $Object | ConvertTo-Json -Depth 8
  $tmp = "$Path.tmp"
  [IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Get-BgConfig([string]$StateDir) {
  $cfg = Read-JsonFile (Join-Path $StateDir 'bluegreen.json')
  if (-not $cfg) { throw "No existe $StateDir\bluegreen.json. Corra antes scripts\bluegreen\setup-230.ps1." }
  return $cfg
}

function Get-BgActive([string]$StateDir) {
  $a = Read-JsonFile (Join-Path $StateDir 'active.json')
  if (-not $a) { throw "No existe $StateDir\active.json." }
  return $a
}

function Get-BgColor($Cfg, [string]$Color) {
  $c = $Cfg.colors.$Color
  if (-not $c) { throw "Color desconocido: $Color" }
  return $c
}

function Get-OtherColor([string]$Color) { if ($Color -eq 'A') { 'B' } else { 'A' } }

function Set-BgActive([string]$StateDir, [string]$Color, [int]$Port, [string]$Sha) {
  Write-JsonFile (Join-Path $StateDir 'active.json') ([ordered]@{
    color = $Color; port = $Port; sha = $Sha; since = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
  })
}

# ---------------------------------------------------------------- pm2
function Invoke-Pm2 {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & pm2 @args | Out-Host; return $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
}

function Get-Pm2Pids {
  # Pids que pm2 reclama. Regex en vez de ConvertFrom-Json: jlist trae claves
  # duplicadas (username/USERNAME) y ConvertFrom-Json falla.
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $raw = (& pm2 jlist 2>$null) -join "`n" } finally { $ErrorActionPreference = $prev }
  $set = @{}
  foreach ($m in [regex]::Matches($raw, '"pid":(\d+)')) { $p = [int]$m.Groups[1].Value; if ($p -gt 0) { $set[$p] = $true } }
  return $set
}

function Test-Pm2App([string]$Name) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $raw = (& pm2 jlist 2>$null) -join "`n" } finally { $ErrorActionPreference = $prev }
  return $raw -match ('"name":"' + [regex]::Escape($Name) + '"')
}

function Remove-Pm2App([string]$Name) {
  if (Test-Pm2App $Name) { [void](Invoke-Pm2 delete $Name) }
}

function Start-Pm2Declared([string]$StateDir, $App) {
  $file = Join-Path $StateDir ("pm2-" + $App.name + ".json")
  Write-JsonFile $file ([ordered]@{ apps = @($App) })
  $rc = Invoke-Pm2 start $file
  if ($rc -ne 0) { throw "pm2 start $($App.name) fallo (codigo $rc)" }
}

function New-FrontApp($Cfg, [string]$Color) {
  $c = Get-BgColor $Cfg $Color
  $envs = [ordered]@{ NODE_ENV = 'production'; PORT = [string]$c.port; BLUEGREEN_COLOR = $Color }
  if ($Cfg.extraEnv) { foreach ($p in $Cfg.extraEnv.PSObject.Properties) { $envs[$p.Name] = [string]$p.Value } }
  return [ordered]@{
    name = $c.name; cwd = $c.dir
    script = (Join-Path $c.dir 'node_modules\next\dist\bin\next')
    args = "start -p $($c.port)"
    interpreter = $Cfg.node; exec_mode = 'fork'; instances = 1; autorestart = $true
    env = $envs
  }
}

function New-McpApp($Cfg, [string]$Color) {
  $c = Get-BgColor $Cfg $Color
  return [ordered]@{
    name = $Cfg.mcp.name; cwd = (Join-Path $c.dir 'mcp'); script = 'serve.mjs'
    interpreter = $Cfg.node; exec_mode = 'fork'; instances = 1; autorestart = $true
    env = [ordered]@{ NODE_ENV = 'production' }
  }
}

# ---------------------------------------------------------------- puertos / procesos
function Get-PortOwners([int]$Port) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if (-not $c) { return @() }
  return @($c | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 })
}

function Wait-PortFree([int]$Port, [string]$OrphanDir, [int]$TimeoutSec = 20) {
  # Espera a que nadie escuche en $Port. Si al final lo retiene un node.exe que
  # pm2 YA NO reclama y cuya linea de comando apunta a $OrphanDir (la carpeta de
  # este proyecto), es un huerfano de pm2 y se cierra por PID exacto. Cualquier
  # otro duenio aborta: no se mata nada ajeno.
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $TimeoutSec) {
    if ((Get-PortOwners $Port).Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  }
  $claimed = Get-Pm2Pids
  foreach ($procId in (Get-PortOwners $Port)) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
    $cmd = if ($p) { [string]$p.CommandLine } else { '' }
    if ($p -and $p.Name -eq 'node.exe' -and -not $claimed.ContainsKey([int]$procId) -and $OrphanDir -and $cmd -like ("*" + $OrphanDir.TrimEnd('\') + "\*")) {
      Write-Host "::warning::Huerfano de pm2 retiene :$Port (PID $procId, $cmd). Se cierra por PID exacto."
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    } else {
      throw "El puerto $Port sigue ocupado por PID $procId ($cmd); no es un huerfano de este proyecto. Abortando sin tocarlo."
    }
  }
  Start-Sleep -Milliseconds 500
  if ((Get-PortOwners $Port).Count -gt 0) { throw "El puerto $Port sigue ocupado tras cerrar el huerfano." }
}

function Wait-PortListening([int]$Port, [int]$TimeoutSec = 30) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $TimeoutSec) {
    if ((Get-PortOwners $Port).Count -gt 0) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

# ---------------------------------------------------------------- HTTP
function Get-HttpStatus([string]$Url, [int]$TimeoutSec = 10) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSec -MaximumRedirection 5
    return [int]$r.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}

function Get-BuildIdAt([string]$BaseUrl) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/api/health/version" -TimeoutSec 5 -Headers @{ 'Cache-Control' = 'no-cache' }
    return [string](($r.Content | ConvertFrom-Json).buildId)
  } catch { return $null }
}

function Wait-Healthy([string]$BaseUrl, [string]$ExpectBuildPrefix, [int]$TimeoutSec = 120) {
  # 200 en / (siguiendo redirecciones) y, si se pide, buildId que empieza por el sha.
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $TimeoutSec) {
    $st = Get-HttpStatus "$BaseUrl/" 10
    if ($st -eq 200) {
      if (-not $ExpectBuildPrefix) { return $true }
      $bid = Get-BuildIdAt $BaseUrl
      if ($bid -and $bid.StartsWith($ExpectBuildPrefix)) { return $true }
      Write-Host "  $BaseUrl responde 200 pero buildId=$bid (espero $ExpectBuildPrefix...)"
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Get-NodeProcsInDir([string]$Dir) {
  return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -like ("*" + $Dir.TrimEnd('\') + "\*") })
}
