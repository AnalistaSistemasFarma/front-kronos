<#
  DESPLIEGUE CON REVERSA AUTOMÁTICA — pase del SGC documental (con cambio de esquema).

  Aprendizaje del incidente del 2026-09-30 (PR #472, SynerLink caído 21 min):
  main.yml detiene las apps para `prisma generate`; si ese paso o el build
  fallan, las deja ABAJO. Este script NUNCA termina con las apps detenidas:

    1. Con las apps ARRIBA: anota el commit actual, copia .next y el cliente
       Prisma generado a carpetas de respaldo, trae el commit nuevo e instala
       dependencias.
    2. Detiene solo las apps del front (y el MCP, que también carga el motor
       de Prisma), espera a que Windows libere el motor, cierra SOLO los node
       huérfanos que retienen el motor de ESTE proyecto y que pm2 ya no
       reclama (doble criterio), y borra los .tmp viejos del motor.
    3. prisma generate (con reintento) y verificación de que el cliente trae
       los modelos del SGC; next build (con reintento) y verificación del BUILD_ID.
    4. Levanta las apps y prueba humo (/login 200, /api/sgc/access 401).
    5. Si CUALQUIER paso de 2–4 falla: vuelve al commit anterior, restaura .next
       y el cliente desde el respaldo y levanta las apps (reversa, ~1–2 min).

  Deja un registro con la duración de cada fase.

  Uso en serfarma05 (PowerShell como administrador, con main.yml DESHABILITADO
  durante el pase para que no corra en paralelo):
    .\scripts\sgc\pase-produccion\desplegar-con-reversa.ps1 `
      -ProjectDir 'C:\Users\administrador.DFARUNIADM\projects\front-kronos' -Ref origin/main `
      -Apps GSS-Front,kronos-mcp -Port 3003 `
      -Pm2Cmd 'C:\Users\nicolas.rivera\AppData\Roaming\npm\pm2.cmd' -Pm2Home 'C:\Users\nicolas.rivera\.pm2'
  Ensayo en PRUEBAS (.230): -ProjectDir 'C:\Users\nicolas.rivera\projects\front-kronos-test' -Ref origin/testing
    -Apps GSS-Front-TEST,kronos-mcp-test -Port 3030 ; -SimularFallo generate|build|humo para probar la reversa.
#>
param(
  [Parameter(Mandatory = $true)][string]$ProjectDir,
  [string]$Ref = 'origin/main',
  [string[]]$Apps = @('GSS-Front', 'kronos-mcp'),
  [int]$Port = 3003,
  [string]$Pm2Cmd = 'pm2',
  [string]$Pm2Home = '',
  [ValidateSet('ninguno', 'generate', 'build', 'humo')][string]$SimularFallo = 'ninguno',
  [string]$ModeloEsperado = 'SgcDocument'
)

$ErrorActionPreference = 'Stop'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $env:TEMP "pase-sgc-$stamp.log"
$global:t0 = Get-Date
function Log([string]$m) { $line = "{0:HH:mm:ss} (+{1,6:N1}s) {2}" -f (Get-Date), ((Get-Date) - $global:t0).TotalSeconds, $m; Write-Host $line; Add-Content -Path $log -Value $line }
if ($Pm2Home) { $env:PM2_HOME = $Pm2Home }
function Pm2([string[]]$a) { $ErrorActionPreference = 'Continue'; & $Pm2Cmd @a 2>&1 | Out-String }

Set-Location $ProjectDir
$prevHead = (git rev-parse HEAD).Trim()
# Respaldo FUERA del proyecto (para que ni el build ni git lo vean).
$bkRoot = Join-Path $env:TEMP "pase-sgc-$stamp"
$bkNext = Join-Path $bkRoot 'next'
$bkGen = Join-Path $bkRoot 'prisma-generado'
Log "Proyecto $ProjectDir · commit actual $prevHead · destino $Ref · registro $log"

# ---------------------------------------------------------------------------
# 1. Con las apps arriba: respaldo de .next y del cliente, código nuevo, dependencias.
# ---------------------------------------------------------------------------
robocopy (Join-Path $ProjectDir '.next') $bkNext /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "No se pudo respaldar .next (robocopy $LASTEXITCODE)" }
robocopy (Join-Path $ProjectDir 'app\generated\prisma') $bkGen /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "No se pudo respaldar el cliente Prisma (robocopy $LASTEXITCODE)" }
Log "Respaldo de .next y del cliente Prisma listo (apps siguen arriba)"
git fetch origin; if ($LASTEXITCODE -ne 0) { throw 'git fetch falló' }
$newHead = (git rev-parse $Ref).Trim()
Log "Commit nuevo: $newHead"

$stopped = $false
$ok = $false
try {
  git reset --hard $Ref; if ($LASTEXITCODE -ne 0) { throw 'git reset falló' }
  npm install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm install falló' }
  Log 'Código y dependencias al día (apps siguen arriba)'

  # -------------------------------------------------------------------------
  # 2. Detener apps, liberar el motor de Prisma.
  # -------------------------------------------------------------------------
  foreach ($a in $Apps) { Pm2 @('stop', $a) | Out-Null }
  $stopped = $true
  Log "Apps detenidas: $($Apps -join ', ')  ← INICIO DE LA INTERRUPCIÓN"
  node scripts\esperar-motor-prisma.cjs 20 500 | Out-Null
  for ($round = 1; $round -le 4; $round++) {
    $claimed = @()
    try { $claimed = (Pm2 @('jlist') | ConvertFrom-Json) | Where-Object { $_.pid -gt 0 } | ForEach-Object { [int]$_.pid } } catch { }
    $holders = Get-Process node -ErrorAction SilentlyContinue | Where-Object {
      try { $_.Modules | Where-Object { $_.FileName -like "$ProjectDir*query_engine*" } } catch { $false }
    }
    $orphans = $holders | Where-Object { $claimed -notcontains $_.Id }
    if (-not $orphans) { break }
    foreach ($o in $orphans) { Log "Cerrando node huérfano $($o.Id) (retiene el motor y pm2 no lo reclama)"; Stop-Process -Id $o.Id -Force }
    Start-Sleep -Seconds 2
    if ($round -eq 4) { throw 'Siguen procesos reteniendo el motor de Prisma tras 4 rondas' }
  }
  Get-ChildItem (Join-Path $ProjectDir 'app\generated\prisma') -Filter '*.tmp*' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

  # -------------------------------------------------------------------------
  # 3. Generar cliente y compilar.
  # -------------------------------------------------------------------------
  if ($SimularFallo -eq 'generate') { throw 'FALLO SIMULADO en prisma generate (ensayo de la reversa)' }
  npx prisma generate
  if ($LASTEXITCODE -ne 0) { node scripts\esperar-motor-prisma.cjs 20 1000 | Out-Null; npx prisma generate; if ($LASTEXITCODE -ne 0) { throw 'prisma generate falló dos veces' } }
  if (-not (Select-String -Path (Join-Path $ProjectDir 'app\generated\prisma\index.d.ts') -Pattern $ModeloEsperado -Quiet)) { throw "El cliente Prisma no trae $ModeloEsperado" }
  Log 'Cliente Prisma generado y verificado'
  if ($SimularFallo -eq 'build') { throw 'FALLO SIMULADO en next build (ensayo de la reversa)' }
  npm run build
  if ($LASTEXITCODE -ne 0) { Start-Sleep -Seconds 5; npm run build; if ($LASTEXITCODE -ne 0) { throw 'next build falló dos veces' } }
  if (-not (Test-Path (Join-Path $ProjectDir '.next\BUILD_ID'))) { throw 'No hay .next\BUILD_ID tras el build' }
  Log "Build listo (BUILD_ID $(Get-Content (Join-Path $ProjectDir '.next\BUILD_ID')))"

  # -------------------------------------------------------------------------
  # 4. Levantar y probar humo.
  # -------------------------------------------------------------------------
  foreach ($a in $Apps) { Pm2 @('start', $a) | Out-Null }
  $stopped = $false
  Log 'Apps levantadas  ← FIN DE LA INTERRUPCIÓN'
  Start-Sleep -Seconds 8
  if ($SimularFallo -eq 'humo') { throw 'FALLO SIMULADO en la prueba de humo (ensayo de la reversa)' }
  $login = (Invoke-WebRequest -Uri "http://localhost:$Port/login" -UseBasicParsing -TimeoutSec 60).StatusCode
  $api = try { (Invoke-WebRequest -Uri "http://localhost:$Port/api/sgc/access" -UseBasicParsing -TimeoutSec 60).StatusCode } catch { [int]$_.Exception.Response.StatusCode }
  if ($login -ne 200 -or $api -ne 401) { throw "Prueba de humo falló (/login=$login, /api/sgc/access=$api)" }
  Log "Humo correcto: /login=$login, /api/sgc/access=$api"
  Pm2 @('save') | Out-Null
  $ok = $true
}
catch {
  Log "ERROR: $($_.Exception.Message)  → REVERSA"
  try {
    foreach ($a in $Apps) { Pm2 @('stop', $a) | Out-Null }
    git reset --hard $prevHead | Out-Null
    robocopy $bkNext (Join-Path $ProjectDir '.next') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    robocopy $bkGen (Join-Path $ProjectDir 'app\generated\prisma') /MIR /XF 'query_engine-windows.dll.node' /NFL /NDL /NJH /NJS /NP | Out-Null
    Log "Reversa aplicada: commit $prevHead, .next y cliente restaurados"
  }
  finally {
    foreach ($a in $Apps) { Pm2 @('start', $a) | Out-Null }
    $stopped = $false
    Start-Sleep -Seconds 8
    $code = try { (Invoke-WebRequest -Uri "http://localhost:$Port/login" -UseBasicParsing -TimeoutSec 60).StatusCode } catch { 0 }
    Log "Apps levantadas tras la reversa (/login=$code)"
  }
}
finally {
  if ($stopped) { foreach ($a in $Apps) { Pm2 @('start', $a) | Out-Null }; Log 'Apps levantadas (salvaguarda final)' }
}

if ($ok) {
  Remove-Item -Recurse -Force $bkRoot -ErrorAction SilentlyContinue
  Log "PASE DE CÓDIGO CORRECTO en $([int]((Get-Date) - $global:t0).TotalSeconds) s. Registro: $log"
  exit 0
}
Log "PASE DE CÓDIGO REVERTIDO. Respaldo conservado en $bkNext y $bkGen. Registro: $log"
exit 1
