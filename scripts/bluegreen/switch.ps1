<#
.SYNOPSIS
  Cambio azul/verde de front-kronos (PRUEBAS en la .230 o PRODUCCION en
  serfarma05): pone en linea el color recien construido y retira el anterior,
  sin pagina de mantenimiento.

.DESCRIPTION
  Lo llaman deploy-testing.yml y main.yml (job "switch"), que NUNCA se cancela
  a mitad. Pasos:
    0. (Produccion) exige que el daemon de pm2 sea el del servicio 0pm2.exe y
       que haya RAM para levantar el color nuevo junto al viejo.
    1. Verifica el sello de build del color destino (mismo sha y run). Si otro
       run ya lo reconstruyo, sale sin hacer nada (ese run hara el cambio).
    2. Arranca el color destino en su puerto propio (pm2, otro nombre) y espera
       HTTP 200 en / y /api/health/version con el sha nuevo (en cluster, varias
       veces seguidas para pasar por todos los workers) y las rutas "smoke".
       Si falla: lo borra y deja todo como estaba (rollback, cero impacto).
    3. Cambia active.json: el proxy fijo (:3030 / :3003) manda las peticiones
       nuevas al color destino en < 0,5 s. Verifica por el proxy que ya sirve
       el sha nuevo; si no, vuelve active.json al color anterior (sigue vivo).
    4. MCP (una sola instancia siempre):
         mcp.mode = 'follow'    (PRUEBAS) se muda a la carpeta nueva en cada
                                deploy: delete + start.
         mcp.mode = 'dedicated' (PRODUCCION) vive en su propia carpeta y SOLO
                                se toca si cambiaron mcp/, prisma/ o la version
                                de Prisma desde la ultima vez (mcp-dedicado.ps1).
    5. Espera el drenaje y borra de pm2 el color anterior; pm2 save.

  -Rollback: vuelve al otro color con el build que ya tiene en disco (el de la
  version anterior). No exige que el sello sea de este run, pero si que el
  sello coincida con el HEAD de esa carpeta. El MCP no se toca.

  Codigos de salida: 0 ok; 1 fallo (si fue antes del paso 3, la version
  anterior sigue atendiendo); 2 front nuevo en linea pero el MCP volvio atras.

  Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.
#>
param(
  [Parameter(Mandatory = $true)][string]$StateDir,
  [string]$Color = '',
  [string]$Sha = '',
  [string]$RunId = 'manual',
  [int]$DrainSeconds = -1,
  [switch]$Rollback
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')
. (Join-Path $PSScriptRoot 'mcp-dedicado.ps1')

$t0 = Get-Date
function Step([string]$m) { Write-Host ("[{0,6:N1}s] {1}" -f ((Get-Date) - $t0).TotalSeconds, $m) }

$cfg = Get-BgConfig $StateDir
Assert-Pm2Daemon $cfg
$active = Get-BgActive $StateDir
$old = $active.color
$new = if ($Color) { $Color } else { Get-OtherColor $old }
if ($old -eq $new) { Write-Host "::notice::El color $new ya esta activo; nada que cambiar."; exit 0 }
$cNew = Get-BgColor $cfg $new
$cOld = Get-BgColor $cfg $old
if ($DrainSeconds -lt 0) { $DrainSeconds = [int](Get-Opt $cfg 'drainSeconds' 20) }
$public = "http://127.0.0.1:$($cfg.proxy.port)"
$candidate = "http://127.0.0.1:$($cNew.port)"
$instances = [int](Get-Opt $cfg 'front.instances' 1)
$consecutive = [Math]::Max(1, 2 * $instances)

# ---- 1. sello
$stamp = Read-JsonFile (Join-Path $cNew.dir '.bluegreen-build.json')
if ($Rollback) {
  if (-not $stamp) { throw "Rollback imposible: $($cNew.dir) no tiene sello de build (.bluegreen-build.json)." }
  $head = (git -C $cNew.dir rev-parse HEAD).Trim()
  if ($head -ne $stamp.sha) { throw "Rollback imposible: el HEAD de $($cNew.dir) ($head) no es el del sello ($($stamp.sha)). La carpeta se esta reconstruyendo." }
  $Sha = [string]$stamp.sha
  Step "ROLLBACK a $new ($($cNew.dir), build $Sha del run $($stamp.runId))"
} else {
  if (-not $Sha) { throw "Falta -Sha" }
  if (-not $stamp -or $stamp.sha -ne $Sha -or ([string]$stamp.runId) -ne [string]$RunId) {
    Write-Host "::notice::La carpeta $($cNew.dir) ya no tiene el build de este run (sello: $($stamp.sha) / run $($stamp.runId)). Otro run mas nuevo la reconstruyo y hara el cambio. Sin cambios."
    exit 0
  }
}
$shaPrefix = $Sha.Substring(0, [Math]::Min(12, $Sha.Length))

# ---- 2. arrancar candidato
Assert-FreeRam ([int](Get-Opt $cfg 'guards.minFreeMbSwitch' 0)) "levantar $($cNew.name) junto a $($cOld.name)"
Step "Arranco candidato $($cNew.name) en :$($cNew.port) desde $($cNew.dir) ($(Get-Opt $cfg 'front.execMode' 'fork') x$instances)"
Remove-Pm2App $cNew.name
Wait-PortFree $cNew.port $cNew.dir 10 $cfg
Start-Pm2Declared $StateDir (New-FrontApp $cfg $new)
$healthy = Wait-Healthy $candidate $shaPrefix 180 $consecutive
$smokeFails = @()
if ($healthy) { $smokeFails = @(Test-Smoke $cfg $candidate) }
if (-not $healthy -or $smokeFails.Count -gt 0) {
  Step "::error::El candidato no paso el smoke test (build $shaPrefix). $($smokeFails -join '; ') Rollback: se borra el candidato; $old sigue atendiendo."
  Remove-Pm2App $cNew.name
  [void](Invoke-Pm2 save)
  exit 1
}
Step "Candidato sano en :$($cNew.port) (buildId $(Get-BuildIdAt $candidate))"

# ---- 3. cambio del proxy
$tSwitch = Get-Date
Set-BgActive $StateDir $new ([int]$cNew.port) $Sha
$okPublic = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 250
  $bid = Get-BuildIdAt $public
  if ($bid -and $bid.StartsWith($shaPrefix)) { $okPublic = $true; break }
}
if ($okPublic) { $okPublic = (Get-HttpStatus "$public/" 15) -eq 200 }
if (-not $okPublic) {
  Step "::error:::$($cfg.proxy.port) no sirvio el build nuevo tras el cambio. Rollback a $old."
  Set-BgActive $StateDir $old ([int]$cOld.port) ([string]$active.sha)
  Start-Sleep -Seconds 1
  Remove-Pm2App $cNew.name
  [void](Invoke-Pm2 save)
  exit 1
}
Step ("Proxy :{0} ya sirve {1} ({2:N2} s desde el cambio). Hueco para el usuario: 0 (las peticiones en curso terminan en {3})." -f $cfg.proxy.port, $new, ((Get-Date) - $tSwitch).TotalSeconds, $old)

# ---- 4. MCP (una sola instancia siempre)
$mcpWarn = $null
$mcpMode = [string](Get-Opt $cfg 'mcp.mode' 'follow')
if ($cfg.mcp.enabled -and $Rollback) {
  Step "Rollback: el MCP no se toca (sigue en su carpeta)."
} elseif ($cfg.mcp.enabled -and $mcpMode -eq 'dedicated') {
  $need = Test-McpNeedsUpdate $cfg $cNew.dir $Sha
  if ($need) {
    Step "MCP: $need -> se actualiza la carpeta dedicada desde $($cNew.dir)"
    try {
      $stg = New-McpStaging $cfg $cNew.dir $Sha
      # Si la carpeta dedicada aun no existe (activacion con -SkipMcp), el MCP
      # corre desde la carpeta canonica: esa es la vuelta atras.
      $fallback = if (-not (Test-Path -LiteralPath (Get-McpRoot $cfg))) { New-McpAppAt $cfg $cfg.linkFrom } else { $null }
      $res = Switch-McpDedicated $cfg $StateDir $stg $fallback
      if (-not $res.ok) { $mcpWarn = $res.message; Write-Host "::warning::$mcpWarn" }
      else { Step $res.message }
    } catch {
      $mcpWarn = "MCP sin actualizar: $($_.Exception.Message)"
      Write-Host "::warning::$mcpWarn"
    }
  } else {
    Step "MCP: sin cambios en mcp/ ni prisma/ desde su ultima version; no se toca (cero hueco)."
  }
} elseif ($cfg.mcp.enabled) {
  $mcpPort = [int]$cfg.mcp.port
  Step "Muevo $($cfg.mcp.name) a $($cNew.dir)\mcp (delete + start, nunca 2 instancias)"
  $tMcp = Get-Date
  Remove-Pm2App $cfg.mcp.name
  Wait-PortFree $mcpPort $cOld.dir 15 $cfg
  Start-Pm2Declared $StateDir (New-McpApp $cfg $new)
  if (Wait-PortListening $mcpPort 40) {
    Step ("MCP escuchando en :{0}; hueco del MCP {1:N1} s" -f $mcpPort, ((Get-Date) - $tMcp).TotalSeconds)
  } else {
    $mcpWarn = "El MCP nuevo no abrio :$mcpPort; se vuelve al de $old."
    Write-Host "::warning::$mcpWarn"
    Remove-Pm2App $cfg.mcp.name
    Wait-PortFree $mcpPort $cNew.dir 15 $cfg
    Start-Pm2Declared $StateDir (New-McpApp $cfg $old)
    if (-not (Wait-PortListening $mcpPort 40)) { Write-Host "::error::Tampoco levanto el MCP anterior. Revisar pm2 logs $($cfg.mcp.name)." }
  }
}

# ---- 5. drenaje y retiro del color anterior
Step "Drenaje de $DrainSeconds s para las peticiones en curso de $old..."
Start-Sleep -Seconds $DrainSeconds
Remove-Pm2App $cOld.name
try { Wait-PortFree ([int]$cOld.port) $cOld.dir 20 $cfg } catch { Write-Host "::warning::$($_.Exception.Message)" }
[void](Invoke-Pm2 save)

$final = Get-HttpStatus "$public/" 15
Step "Estado final: :$($cfg.proxy.port) -> HTTP $final; activo $new ($shaPrefix); $old retirado (su build queda en disco para rollback)."
if ($final -ne 200) { exit 1 }
if ($mcpWarn) { exit 2 }
exit 0
