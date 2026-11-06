<#
.SYNOPSIS
  PRODUCCION: verifica, SIN escribir nada en la base, que los cambios de
  esquema que trae el commit nuevo YA estan aplicados en la BD (los SQL de prod
  son manuales y van ANTES del merge).

.DESCRIPTION
  El schema.prisma del repo es PARCIAL frente a KRONOSDB (hay tablas y columnas
  que no modela), asi que un diff completo siempre trae ruido. Por eso se
  compara contra la version ACTIVA:
    1. `prisma migrate diff --from-schema-datasource` (introspeccion de la BD,
       solo lectura) contra el schema VIEJO (el del sha activo) y contra el
       NUEVO.
    2. De cada salida se extraen solo los objetos que FALTAN en la BD:
       CREATE TABLE y columnas de ALTER TABLE ... ADD (sin constraints ni
       indices, que son ruido de nombres).
    3. Falla si el schema nuevo necesita algo que falta y que el viejo no
       necesitaba: es decir, el SQL de este pase no se aplico.
  Lo corre main.yml en el job de build, en la carpeta INACTIVA ya instalada
  (usa su prisma CLI y su .env enlazado). Si falla, no hay cambio de color: la
  version activa sigue atendiendo.

  Codigos: 0 todo aplicado; 1 faltan objetos; 3 no se pudo verificar.

  Archivo en ASCII a proposito: PowerShell 5.1 lee .ps1 sin BOM como ANSI.
#>
param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][string]$OldSha,
  [Parameter(Mandatory = $true)][string]$NewSha
)

$ErrorActionPreference = 'Stop'

function Get-MissingObjects([string]$Sql) {
  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($m in [regex]::Matches($Sql, 'CREATE TABLE \[[^\]]+\]\.\[(?<t>[^\]]+)\]')) { [void]$set.Add("tabla " + $m.Groups['t'].Value) }
  foreach ($m in [regex]::Matches($Sql, 'ALTER TABLE \[[^\]]+\]\.\[(?<t>[^\]]+)\] ADD (?<b>[^;]+);')) {
    $b = $m.Groups['b'].Value
    if ($b -match '^\s*CONSTRAINT') { continue }
    foreach ($c in [regex]::Matches($b, '(?:^|,)\s*\[(?<c>[^\]]+)\]\s+[A-Za-z]')) { [void]$set.Add("columna " + $m.Groups['t'].Value + "." + $c.Groups['c'].Value) }
  }
  return $set
}

function Invoke-Diff([string]$SchemaFile) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $out = & npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel $SchemaFile --script 2>&1
    $rc = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev }
  # rc 0 = sin diferencias o con script; rc 2 = hay diferencias (--exit-code no se usa)
  if ($rc -ne 0) {
    $msg = (($out | Select-Object -Last 5) -join ' ') -replace '(?i)(password|pwd)=[^;]*', '$1=***'
    throw "prisma migrate diff fallo (rc $rc): $msg"
  }
  return ($out -join "`n")
}

Push-Location $Dir
try {
  $tmpOld = Join-Path $env:TEMP ("schema-activo-" + $OldSha.Substring(0, 8) + ".prisma")
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $oldSchema = git show "${OldSha}:prisma/schema.prisma" 2>$null
  $gitRc = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($gitRc -ne 0) { Write-Host "::error::No se pudo leer prisma/schema.prisma de $OldSha"; exit 3 }
  [IO.File]::WriteAllText($tmpOld, ($oldSchema -join "`n"), (New-Object Text.UTF8Encoding($false)))

  try {
    Write-Host "Introspeccion de la BD (solo lectura) vs schema ACTIVO ($($OldSha.Substring(0,8)))..."
    $missOld = Get-MissingObjects (Invoke-Diff $tmpOld)
    Write-Host "Introspeccion de la BD (solo lectura) vs schema NUEVO ($($NewSha.Substring(0,8)))..."
    $missNew = Get-MissingObjects (Invoke-Diff 'prisma/schema.prisma')
  } catch {
    Write-Host "::error::No se pudo verificar el esquema: $($_.Exception.Message)"
    exit 3
  } finally { Remove-Item -LiteralPath $tmpOld -Force -ErrorAction SilentlyContinue }

  $faltan = @($missNew | Where-Object { -not $missOld.Contains($_) } | Sort-Object)
  Write-Host ("Objetos que el schema activo ya echaba en falta (ruido historico, se ignoran): {0}" -f $missOld.Count)
  if ($faltan.Count -gt 0) {
    Write-Host "::error::La BD de produccion NO tiene lo que pide el schema nuevo. Aplique los SQL del pase (con respaldo) ANTES de desplegar:"
    foreach ($f in $faltan) { Write-Host "  - $f" }
    exit 1
  }
  Write-Host "OK: todo lo que agrega el schema nuevo ya existe en la BD."
  exit 0
} finally { Pop-Location }
