# Funciones comunes del despliegue azul/verde de front-kronos.
# Las usan PRUEBAS (.230, setup-230.ps1) y PRODUCCION (serfarma05,
# setup-serfarma05.ps1). Todo lo que se agrego para produccion es OPCIONAL en
# bluegreen.json: sin esas claves el comportamiento es el de PRUEBAS.
# Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.
#
# Estado (carpeta de estado):
#   bluegreen.json  configuracion fija (colores, puertos, nombres pm2, MCP)
#   active.json     color activo {color, port, sha, since}; lo lee proxy.cjs
#   proxy.cjs       copia estable del proxy (no vive en una carpeta de release)
#   pm2-*.json      declaraciones pm2 generadas para cada arranque
#
# Claves opcionales de bluegreen.json (produccion):
#   pm2.home / pm2.cmd   PM2_HOME y ruta de pm2.cmd (no depender del PATH)
#   pm2.service          nombre del servicio de Windows que aloja el daemon
#                        ("0pm2.exe"). Si esta, ANTES de cualquier llamada a pm2
#                        se exige que el daemon vivo sea el del servicio (un
#                        `pm2 jlist` sin daemon arranca otro: incidente 2026-10-28).
#   front.execMode / front.instances / front.cronRestart / front.killTimeout
#   mcp.mode             'follow' (PRUEBAS: el MCP se muda al color activo en
#                        cada deploy) o 'dedicated' (PRODUCCION: carpeta propia,
#                        solo se toca cuando cambian mcp/ o prisma/)
#   guards.minFreeMbBuild / guards.minFreeMbSwitch   RAM libre minima
#   build.voiceMigration (def. true) / build.cleanOrphans (def. false)
#   smoke                lista de rutas {path, expect[]} para el candidato

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

function Get-Opt($Obj, [string]$Path, $Default) {
  # Lee una clave anidada opcional ("front.instances"); si falta, $Default.
  $cur = $Obj
  foreach ($p in $Path.Split('.')) {
    if ($null -eq $cur) { return $Default }
    $prop = $cur.PSObject.Properties[$p]
    if (-not $prop) { return $Default }
    $cur = $prop.Value
  }
  if ($null -eq $cur -or ($cur -is [string] -and $cur -eq '')) { return $Default }
  return $cur
}

$script:Pm2Exe = 'pm2'

function Set-Pm2Context($Cfg) {
  $cmd = Get-Opt $Cfg 'pm2.cmd' $null
  $home2 = Get-Opt $Cfg 'pm2.home' $null
  if ($cmd) { $script:Pm2Exe = [string]$cmd }
  if ($home2) { $env:PM2_HOME = [string]$home2 }
}

function Get-BgConfig([string]$StateDir) {
  $cfg = Read-JsonFile (Join-Path $StateDir 'bluegreen.json')
  if (-not $cfg) { throw "No existe $StateDir\bluegreen.json. Corra antes el setup (setup-230.ps1 / setup-serfarma05.ps1)." }
  Set-Pm2Context $cfg
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

# ---------------------------------------------------------------- entorno limpio
function Invoke-WithCleanEnv([scriptblock]$Block) {
  # pm2 copia el entorno de quien lo llama a la app que arranca. Desde un job de
  # GitHub eso incluye RUNNER_TRACKING_ID (el runner MATA la app al cerrar el
  # job; pm2 la revive tras ~20-35 s sin servicio), tokens de corta vida
  # (ACTIONS_RUNTIME_TOKEN, ACTIONS_ID_TOKEN_REQUEST_TOKEN) y GITHUB_*. Por SSH,
  # SSH_*. Nada de eso debe quedar en una app de larga vida: se quita del
  # proceso mientras corre pm2 y se restaura despues.
  $saved = @{}
  foreach ($e in @(Get-ChildItem Env:)) {
    if ($e.Name -match '^(RUNNER_|GITHUB_|ACTIONS_|INPUT_|SSH_)') {
      $saved[$e.Name] = $e.Value
      Remove-Item -LiteralPath ("Env:" + $e.Name) -ErrorAction SilentlyContinue
    }
  }
  try { & $Block } finally {
    foreach ($k in $saved.Keys) { if ($k -ne 'RUNNER_TRACKING_ID') { Set-Item -LiteralPath ("Env:" + $k) -Value $saved[$k] } }
  }
}

# ---------------------------------------------------------------- daemon de pm2
function Get-Pm2DaemonPids {
  # Padres de los procesos de apps de pm2 (ProcessContainer*.js) = daemon(s) vivos.
  $cont = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'pm2[\\/]lib[\\/]ProcessContainer(Fork)?\.js' })
  return @($cont | ForEach-Object { [int]$_.ParentProcessId } | Sort-Object -Unique)
}

function Get-ServiceDescendants([int]$RootPid) {
  $all = @(Get-CimInstance Win32_Process)
  $set = New-Object 'System.Collections.Generic.HashSet[int]'
  [void]$set.Add($RootPid)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($p in $all) {
      if ($set.Contains([int]$p.ParentProcessId) -and -not $set.Contains([int]$p.ProcessId)) { [void]$set.Add([int]$p.ProcessId); $changed = $true }
    }
  }
  return $set
}

function Assert-Pm2Daemon($Cfg) {
  # Solo con pm2.service (produccion). No ejecuta pm2: mira procesos.
  # Exige: servicio Running, un unico daemon con apps, que ese daemon descienda
  # del servicio y que no haya un Daemon.js manual. Si algo no cuadra, aborta
  # ANTES de llamar a pm2 (un pm2 sin daemon arranca uno nuevo fuera del servicio).
  $svcName = Get-Opt $Cfg 'pm2.service' $null
  if (-not $svcName) { return }
  $svc = Get-CimInstance Win32_Service -Filter ("Name='" + $svcName + "'")
  if (-not $svc -or $svc.State -ne 'Running') { throw "El servicio $svcName no esta Running. NO se llama a pm2 (arrancaria un daemon fuera del servicio). Ver gotcha-serfarma05-pm2-segundo-daemon." }
  $all = @(Get-CimInstance Win32_Process)
  $manual = @($all | Where-Object { $_.CommandLine -match 'pm2[\\/]lib[\\/]Daemon\.js' })
  $daemons = Get-Pm2DaemonPids
  $desc = Get-ServiceDescendants ([int]$svc.ProcessId)
  $ajenos = @($daemons | Where-Object { -not $desc.Contains([int]$_) })
  if ($daemons.Count -ne 1 -or $manual.Count -gt 0 -or $ajenos.Count -gt 0) {
    throw ("PM2 no esta en el estado esperado: daemons con apps={0} (esperado 1), Daemon.js manuales={1}, daemons fuera de {2}={3}. NO se llama a pm2. Revisar con P01 del runbook." -f $daemons.Count, $manual.Count, $svcName, $ajenos.Count)
  }
}

# ---------------------------------------------------------------- pm2
function Invoke-Pm2 {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $script:Pm2Exe @args | Out-Host; return $LASTEXITCODE } finally { $ErrorActionPreference = $prev }
}

function Get-Pm2Jlist {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { return ((& $script:Pm2Exe jlist 2>$null) -join "`n") } finally { $ErrorActionPreference = $prev }
}

function Get-Pm2Pids {
  # Pids que pm2 reclama. Regex en vez de ConvertFrom-Json: jlist trae claves
  # duplicadas (username/USERNAME) y ConvertFrom-Json falla.
  $raw = Get-Pm2Jlist
  $set = @{}
  foreach ($m in [regex]::Matches($raw, '"pid":(\d+)')) { $p = [int]$m.Groups[1].Value; if ($p -gt 0) { $set[$p] = $true } }
  return $set
}

function Get-ClaimedPids($Cfg) {
  # Procesos "de pm2". Con servicio: todo lo que desciende del servicio (sin
  # llamar a pm2). Sin servicio (PRUEBAS): los pids de jlist.
  $svcName = Get-Opt $Cfg 'pm2.service' $null
  if ($svcName) {
    $svc = Get-CimInstance Win32_Service -Filter ("Name='" + $svcName + "'")
    $set = @{}
    if ($svc -and $svc.ProcessId) { foreach ($p in (Get-ServiceDescendants ([int]$svc.ProcessId))) { $set[[int]$p] = $true } }
    return $set
  }
  return Get-Pm2Pids
}

function Test-Pm2App([string]$Name) {
  $raw = Get-Pm2Jlist
  return $raw -match ('"name":"' + [regex]::Escape($Name) + '"')
}

function Get-Pm2AppField([string]$Name, [string]$Field) {
  # Valor de un campo simple (string/numero) del primer bloque de jlist de esa app.
  $raw = Get-Pm2Jlist
  $i = $raw.IndexOf('"name":"' + $Name + '"')
  if ($i -lt 0) { return $null }
  $seg = $raw.Substring($i, [Math]::Min(20000, $raw.Length - $i))
  $m = [regex]::Match($seg, '"' + [regex]::Escape($Field) + '":"?([^",}]*)')
  if ($m.Success) { return $m.Groups[1].Value } else { return $null }
}

function Remove-Pm2App([string]$Name) {
  if (Test-Pm2App $Name) { [void](Invoke-Pm2 delete $Name) }
}

function Start-Pm2Declared([string]$StateDir, $App) {
  $file = Join-Path $StateDir ("pm2-" + $App.name + ".json")
  Write-JsonFile $file ([ordered]@{ apps = @($App) })
  $rc = Invoke-WithCleanEnv { Invoke-Pm2 start $file }
  if ($rc -ne 0) { throw "pm2 start $($App.name) fallo (codigo $rc)" }
}

function New-FrontApp($Cfg, [string]$Color) {
  $c = Get-BgColor $Cfg $Color
  $envs = [ordered]@{ NODE_ENV = 'production'; PORT = [string]$c.port; BLUEGREEN_COLOR = $Color }
  if ($Cfg.extraEnv) { foreach ($p in $Cfg.extraEnv.PSObject.Properties) { $envs[$p.Name] = [string]$p.Value } }
  $mode = [string](Get-Opt $Cfg 'front.execMode' 'fork')
  $app = [ordered]@{
    name = $c.name; cwd = $c.dir
    script = (Join-Path $c.dir 'node_modules\next\dist\bin\next')
    args = "start -p $($c.port)"
    exec_mode = $mode; instances = [int](Get-Opt $Cfg 'front.instances' 1); autorestart = $true
    env = $envs
  }
  # En cluster pm2 usa el node del daemon; el interprete solo aplica en fork.
  if ($mode -eq 'fork') { $app['interpreter'] = $Cfg.node }
  $cron = Get-Opt $Cfg 'front.cronRestart' $null; if ($cron) { $app['cron_restart'] = [string]$cron }
  $kt = Get-Opt $Cfg 'front.killTimeout' $null; if ($kt) { $app['kill_timeout'] = [int]$kt }
  $mm = Get-Opt $Cfg 'front.maxMemoryRestart' $null; if ($mm) { $app['max_memory_restart'] = [string]$mm }
  return $app
}

function New-McpAppAt($Cfg, [string]$RootDir) {
  $app = [ordered]@{
    name = $Cfg.mcp.name; cwd = (Join-Path $RootDir 'mcp'); script = 'serve.mjs'
    interpreter = $Cfg.node; exec_mode = 'fork'; instances = 1; autorestart = $true
    env = [ordered]@{ NODE_ENV = 'production' }
  }
  $cron = Get-Opt $Cfg 'mcp.cronRestart' $null; if ($cron) { $app['cron_restart'] = [string]$cron }
  return $app
}

function New-McpApp($Cfg, [string]$Color) {
  $c = Get-BgColor $Cfg $Color
  return New-McpAppAt $Cfg $c.dir
}

# ---------------------------------------------------------------- memoria
function Get-FreeRamMb { return [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024) }

function Assert-FreeRam([int]$MinMb, [string]$What) {
  if ($MinMb -le 0) { return }
  $free = Get-FreeRamMb
  if ($free -lt $MinMb) { throw "RAM libre $free MB < $MinMb MB exigidos para $What. No se hace nada (la version activa sigue atendiendo)." }
  Write-Host "RAM libre $free MB (minimo $MinMb MB para $What)"
}

# ---------------------------------------------------------------- puertos / procesos
function Get-PortOwners([int]$Port) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if (-not $c) { return @() }
  return @($c | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 })
}

function Test-ProcTouchesDir($Proc, [string]$Dir) {
  # Por linea de comando (apps fork) o por modulo nativo cargado (los workers de
  # cluster son ProcessContainer.js y no muestran la carpeta en la linea de
  # comando; los huerfanos retienen query_engine / next-swc).
  $d = $Dir.TrimEnd('\') + '\'
  if ($Proc.CommandLine -and $Proc.CommandLine -like ("*" + $d + "*")) { return $true }
  try {
    $gp = Get-Process -Id $Proc.ProcessId -ErrorAction Stop
    foreach ($m in $gp.Modules) { if ($m.FileName -like ($d + "*")) { return $true } }
  } catch { }
  return $false
}

function Get-NodeProcsInDir([string]$Dir) {
  return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { Test-ProcTouchesDir $_ $Dir })
}

function Clear-OrphansInDir($Cfg, [string]$Dir, [int]$Rounds = 4) {
  # Cierra node.exe HUERFANOS que usan $Dir: los que pm2 ya no reclama. Si algun
  # proceso de pm2 usa la carpeta, aborta (hay algo vivo ahi). Doble criterio
  # (usa la carpeta Y pm2 no lo reclama): nunca se mata nada ajeno.
  for ($r = 1; $r -le $Rounds; $r++) {
    $procs = Get-NodeProcsInDir $Dir
    if ($procs.Count -eq 0) { return }
    $claimed = Get-ClaimedPids $Cfg
    foreach ($p in $procs) {
      if ($claimed.ContainsKey([int]$p.ProcessId)) { throw "PID $($p.ProcessId) es de pm2 y usa $Dir. No se toca esa carpeta." }
      Write-Host "::warning::Huerfano de pm2 en $Dir (PID $($p.ProcessId)). Se cierra por PID exacto."
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
  }
  if ((Get-NodeProcsInDir $Dir).Count -gt 0) { throw "Siguen procesos node usando $Dir tras $Rounds rondas." }
}

function Wait-PortFree([int]$Port, [string]$OrphanDir, [int]$TimeoutSec = 20, $Cfg = $null) {
  # Espera a que nadie escuche en $Port. Si al final lo retiene un node.exe que
  # pm2 YA NO reclama y que usa $OrphanDir (la carpeta de este proyecto), es un
  # huerfano de pm2 y se cierra por PID exacto. En cluster el socket lo tiene el
  # daemon de pm2: eso solo se espera, nunca se mata. Cualquier otro duenio
  # aborta: no se mata nada ajeno.
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $TimeoutSec) {
    if ((Get-PortOwners $Port).Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  }
  $claimed = if ($Cfg) { Get-ClaimedPids $Cfg } else { Get-Pm2Pids }
  $daemons = Get-Pm2DaemonPids
  foreach ($procId in (Get-PortOwners $Port)) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
    $cmd = if ($p) { [string]$p.CommandLine } else { '' }
    if ($daemons -contains [int]$procId) { throw "El puerto $Port sigue en manos del daemon de pm2 (PID $procId, cluster). No se mata el daemon." }
    if ($p -and $p.Name -eq 'node.exe' -and -not $claimed.ContainsKey([int]$procId) -and $OrphanDir -and (Test-ProcTouchesDir $p $OrphanDir)) {
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

function Wait-Healthy([string]$BaseUrl, [string]$ExpectBuildPrefix, [int]$TimeoutSec = 120, [int]$Consecutive = 1) {
  # 200 en / (siguiendo redirecciones) y, si se pide, buildId que empieza por el
  # sha. Con -Consecutive N exige N aciertos seguidos (en cluster cada peticion
  # cae en un worker distinto: asi se comprueban todos).
  $t0 = Get-Date
  $ok = 0
  while (((Get-Date) - $t0).TotalSeconds -lt $TimeoutSec) {
    $good = $false
    $st = Get-HttpStatus "$BaseUrl/" 10
    if ($st -eq 200) {
      if (-not $ExpectBuildPrefix) { $good = $true }
      else {
        $bid = Get-BuildIdAt $BaseUrl
        if ($bid -and $bid.StartsWith($ExpectBuildPrefix)) { $good = $true }
        else { Write-Host "  $BaseUrl responde 200 pero buildId=$bid (espero $ExpectBuildPrefix...)" }
      }
    }
    if ($good) { $ok++; if ($ok -ge $Consecutive) { return $true }; Start-Sleep -Milliseconds 300; continue }
    $ok = 0
    Start-Sleep -Seconds 2
  }
  return $false
}

function Test-Smoke($Cfg, [string]$BaseUrl) {
  # Rutas extra del smoke test (bluegreen.json "smoke"): [{path, expect:[...]}].
  # Devuelve la lista de fallos (vacia = todo bien).
  $fallos = @()
  foreach ($s in @(Get-Opt $Cfg 'smoke' @())) {
    if (-not $s) { continue }
    $st = Get-HttpStatus ($BaseUrl + [string]$s.path) 20
    $exp = @($s.expect | ForEach-Object { [int]$_ })
    if ($exp -notcontains $st) { $fallos += "$($s.path) -> $st (esperado $($exp -join '/'))" }
    else { Write-Host "  smoke $($s.path) -> $st" }
  }
  return $fallos
}
