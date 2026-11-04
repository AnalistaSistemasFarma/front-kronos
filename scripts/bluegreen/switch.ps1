<#
.SYNOPSIS
  Cambio azul/verde del entorno de PRUEBAS (.230): pone en linea el color recien
  construido y retira el anterior, sin pagina de mantenimiento.

.DESCRIPTION
  Lo llama .github/workflows/deploy-testing.yml (job "switch"), que NUNCA se
  cancela a mitad. Pasos:
    1. Verifica el sello de build del color destino (mismo sha y run). Si otro
       run ya lo reconstruyo, sale sin hacer nada (ese run hara el cambio).
    2. Arranca el color destino en su puerto propio (pm2, otro nombre) y espera
       HTTP 200 en / y /api/health/version con el sha nuevo.
       Si falla: lo borra y deja todo como estaba (rollback, cero impacto).
    3. Cambia active.json: el proxy fijo en :3030 manda las peticiones nuevas al
       color destino en < 0,5 s. Verifica por :3030 que ya sirve el sha nuevo;
       si no, vuelve active.json al color anterior (que sigue vivo).
    4. Mueve kronos-mcp-test a la carpeta nueva: delete del viejo y start del
       nuevo (nunca 2 instancias). Si el nuevo no levanta, vuelve al viejo.
    5. Espera el drenaje y borra de pm2 el color anterior; pm2 save.

  Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.
#>
param(
  [Parameter(Mandatory = $true)][string]$StateDir,
  [Parameter(Mandatory = $true)][string]$Color,
  [Parameter(Mandatory = $true)][string]$Sha,
  [string]$RunId = 'manual',
  [int]$DrainSeconds = -1
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib.ps1')

$t0 = Get-Date
function Step([string]$m) { Write-Host ("[{0,6:N1}s] {1}" -f ((Get-Date) - $t0).TotalSeconds, $m) }

$cfg = Get-BgConfig $StateDir
$active = Get-BgActive $StateDir
$old = $active.color
$new = $Color
if ($old -eq $new) { Write-Host "::notice::El color $new ya esta activo; nada que cambiar."; exit 0 }
$cNew = Get-BgColor $cfg $new
$cOld = Get-BgColor $cfg $old
if ($DrainSeconds -lt 0) { $DrainSeconds = if ($cfg.drainSeconds) { [int]$cfg.drainSeconds } else { 20 } }
$shaPrefix = $Sha.Substring(0, [Math]::Min(12, $Sha.Length))
$public = "http://127.0.0.1:$($cfg.proxy.port)"
$candidate = "http://127.0.0.1:$($cNew.port)"

# ---- 1. sello
$stamp = Read-JsonFile (Join-Path $cNew.dir '.bluegreen-build.json')
if (-not $stamp -or $stamp.sha -ne $Sha -or ([string]$stamp.runId) -ne [string]$RunId) {
  Write-Host "::notice::La carpeta $($cNew.dir) ya no tiene el build de este run (sello: $($stamp.sha) / run $($stamp.runId)). Otro run mas nuevo la reconstruyo y hara el cambio. Sin cambios."
  exit 0
}

# ---- 2. arrancar candidato
Step "Arranco candidato $($cNew.name) en :$($cNew.port) desde $($cNew.dir)"
Remove-Pm2App $cNew.name
Wait-PortFree $cNew.port $cNew.dir 10
Start-Pm2Declared $StateDir (New-FrontApp $cfg $new)
if (-not (Wait-Healthy $candidate $shaPrefix 150)) {
  Step "::error::El candidato no respondio 200 con el build $shaPrefix. Rollback: se borra el candidato; $old sigue atendiendo."
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
if ($cfg.mcp.enabled) {
  $mcpPort = [int]$cfg.mcp.port
  Step "Muevo $($cfg.mcp.name) a $($cNew.dir)\mcp (delete + start, nunca 2 instancias)"
  $tMcp = Get-Date
  Remove-Pm2App $cfg.mcp.name
  Wait-PortFree $mcpPort $cOld.dir 15
  Start-Pm2Declared $StateDir (New-McpApp $cfg $new)
  if (Wait-PortListening $mcpPort 40) {
    Step ("MCP escuchando en :{0}; hueco del MCP {1:N1} s" -f $mcpPort, ((Get-Date) - $tMcp).TotalSeconds)
  } else {
    $mcpWarn = "El MCP nuevo no abrio :$mcpPort; se vuelve al de $old."
    Write-Host "::warning::$mcpWarn"
    Remove-Pm2App $cfg.mcp.name
    Wait-PortFree $mcpPort $cNew.dir 15
    Start-Pm2Declared $StateDir (New-McpApp $cfg $old)
    if (-not (Wait-PortListening $mcpPort 40)) { Write-Host "::error::Tampoco levanto el MCP anterior. Revisar pm2 logs $($cfg.mcp.name)." }
  }
}

# ---- 5. drenaje y retiro del color anterior
Step "Drenaje de $DrainSeconds s para las peticiones en curso de $old..."
Start-Sleep -Seconds $DrainSeconds
Remove-Pm2App $cOld.name
try { Wait-PortFree ([int]$cOld.port) $cOld.dir 20 } catch { Write-Host "::warning::$($_.Exception.Message)" }
[void](Invoke-Pm2 save)

$final = Get-HttpStatus "$public/" 15
Step "Estado final: :$($cfg.proxy.port) -> HTTP $final; activo $new ($shaPrefix); $old retirado."
if ($final -ne 200) { exit 1 }
if ($mcpWarn) { exit 2 }
exit 0
