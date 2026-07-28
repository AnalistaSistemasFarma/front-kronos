#!/usr/bin/env node
/**
 * prod-gate-check.mjs — Compuerta GO / NO-GO / GO-CONDICIONADO para el pase a
 * producción de front-kronos (Fase 2 del plan de control de calidad).
 *
 * Ejecuta y agrega la batería de validación del "flujo de autorización":
 *   1. tsc --noEmit (raíz)
 *   2. lint (no bloqueante si el único error es el preexistente de
 *      ecosystem-test.config.js)
 *   3. pruebas + cobertura del front (npm test -- --coverage)
 *   4. pruebas del MCP (cd mcp && npm test)
 *   5. npm audit --json (raíz y mcp) — informativo, resumido por severidad
 *   6. Chequeo de DDL/esquema: detecta SQL de esquema en el diff SIN script
 *      .sql/migración que lo acompañe → GO-CONDICIONADO ("correr DDL manual").
 *   7. Regresión de tools MCP: el MCP compila y sus pruebas pasan; se avisa si
 *      cambió el conteo de tools declarado en las aserciones de mcp/test.
 *
 * Veredicto:
 *   GO              → todas las compuertas bloqueantes en verde. exit 0.
 *   GO-CONDICIONADO → verde salvo acciones manuales pendientes (p. ej. DDL).
 *                     exit 0, pero con advertencias claras.
 *   NO-GO           → alguna compuerta bloqueante en rojo. exit != 0.
 *
 * Flags:
 *   --base <rama>   Rama base para el diff (default: origin/main).
 *   --skip-build    Omite el `next build` implícito (aquí no se corre build;
 *                   la bandera se acepta por compatibilidad y para el futuro).
 *
 * Uso local (Agente Orus): ver scripts/README.md.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Parseo de flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let baseRef = 'origin/main';
let skipBuild = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base') baseRef = args[++i];
  else if (args[i].startsWith('--base=')) baseRef = args[i].split('=')[1];
  else if (args[i] === '--skip-build') skipBuild = true;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const OK = '✅';
const WARN = '⚠️';
const BAD = '❌';

/** Ejecuta un comando y captura salida. Nunca lanza. */
function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd: opts.cwd || ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  return {
    code: r.status ?? (r.error ? 1 : 0),
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error,
  };
}

/** Cada compuerta: { name, status: 'ok'|'warn'|'bad', detail, actions[] } */
const gates = [];
function addGate(name, status, detail, actions = []) {
  gates.push({ name, status, detail, actions });
}

// ---------------------------------------------------------------------------
// 1. tsc --noEmit (raíz) — BLOQUEANTE
// ---------------------------------------------------------------------------
function checkTsc() {
  const r = run('npx', ['tsc', '--noEmit']);
  if (r.code === 0) {
    addGate('tsc --noEmit (raíz)', 'ok', 'Sin errores de tipos.');
  } else {
    const errLines = (r.stdout + r.stderr)
      .split('\n')
      .filter((l) => /error TS\d+/.test(l));
    addGate(
      'tsc --noEmit (raíz)',
      'bad',
      `${errLines.length} error(es) de tipos.`,
      ['Corregir los errores de tipos antes del pase.'],
    );
  }
}

// ---------------------------------------------------------------------------
// 2. lint — NO bloqueante si el único error es el preexistente
// ---------------------------------------------------------------------------
const PREEXISTING_LINT = 'ecosystem-test.config.js';
function checkLint() {
  const r = run('npm', ['run', 'lint']);
  const out = r.stdout + r.stderr;
  // Cuenta líneas de error de eslint (formato "  L:C  error  ...").
  const errorLines = out
    .split('\n')
    .filter((l) => /\berror\b/.test(l) && /^\s*\d+:\d+/.test(l));
  const onlyPreexisting =
    errorLines.length > 0 &&
    errorLines.every(() => true) &&
    out.includes(PREEXISTING_LINT) &&
    // El único archivo con error debe ser el preexistente.
    !hasNewLintErrors(out);

  if (r.code === 0 && errorLines.length === 0) {
    addGate('lint (eslint)', 'ok', 'Sin errores.');
  } else if (onlyPreexisting || (r.code === 0 && errorLines.length > 0)) {
    addGate(
      'lint (eslint)',
      'warn',
      `Solo deuda preexistente (${PREEXISTING_LINT}). No bloquea.`,
    );
  } else {
    addGate(
      'lint (eslint)',
      'bad',
      `Errores de lint NUEVOS (${errorLines.length}).`,
      ['Corregir los errores de lint introducidos por este cambio.'],
    );
  }
}

/** Heurística: hay errores de lint en archivos distintos al preexistente. */
function hasNewLintErrors(out) {
  const blocks = out.split(/\n(?=\/|[A-Za-z]:\\)/); // por archivo
  for (const b of blocks) {
    if (!/\berror\b/.test(b)) continue;
    if (!/^\s*\d+:\d+/m.test(b)) continue;
    if (!b.includes(PREEXISTING_LINT)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 3. Pruebas + cobertura del front — BLOQUEANTE (incluye umbral de cobertura)
// ---------------------------------------------------------------------------
function checkFrontTests() {
  const r = run('npm', ['test', '--', '--coverage']);
  const out = r.stdout + r.stderr;
  let covDetail = '';
  const covPath = join(ROOT, 'coverage', 'coverage-summary.json');
  if (existsSync(covPath)) {
    try {
      const total = JSON.parse(readFileSync(covPath, 'utf8')).total || {};
      if (total.lines) {
        covDetail = ` Cobertura: líneas ${total.lines.pct}%, func ${total.functions.pct}%, ramas ${total.branches.pct}%, stmts ${total.statements.pct}%.`;
      }
    } catch {
      /* ignore */
    }
  }
  if (r.code === 0) {
    addGate(
      'Pruebas + cobertura (front)',
      'ok',
      `Suite verde y umbral de cobertura cumplido.${covDetail}`,
    );
  } else {
    const threshFail = /ERROR: Coverage.*threshold/i.test(out);
    addGate(
      'Pruebas + cobertura (front)',
      'bad',
      threshFail
        ? `Cobertura por DEBAJO del piso.${covDetail}`
        : `Falló la suite de pruebas del front.${covDetail}`,
      threshFail
        ? ['Subir la cobertura o revisar por qué bajó del piso.']
        : ['Corregir las pruebas del front en rojo.'],
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Pruebas del MCP — BLOQUEANTE
// ---------------------------------------------------------------------------
function checkMcpTests() {
  const mcpDir = join(ROOT, 'mcp');
  if (!existsSync(mcpDir)) {
    addGate('Pruebas MCP', 'warn', 'No existe el directorio mcp/.');
    return;
  }
  const r = run('npm', ['test'], { cwd: mcpDir });
  if (r.code === 0) {
    addGate('Pruebas MCP', 'ok', 'Suite del MCP en verde.');
  } else {
    addGate('Pruebas MCP', 'bad', 'Falló la suite del MCP.', [
      'Corregir las pruebas del MCP en rojo.',
    ]);
  }
}

// ---------------------------------------------------------------------------
// 5. npm audit (raíz y mcp) — INFORMATIVO
// ---------------------------------------------------------------------------
function summarizeAudit(cwd, label) {
  const r = run('npm', ['audit', '--json'], { cwd });
  let sev = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  try {
    const j = JSON.parse(r.stdout || '{}');
    if (j.metadata && j.metadata.vulnerabilities) {
      sev = { ...sev, ...j.metadata.vulnerabilities };
    }
  } catch {
    addGate(`npm audit (${label})`, 'warn', 'No se pudo parsear el audit.');
    return;
  }
  const total =
    (sev.critical || 0) +
    (sev.high || 0) +
    (sev.moderate || 0) +
    (sev.low || 0) +
    (sev.info || 0);
  const detail = `crit ${sev.critical}, high ${sev.high}, mod ${sev.moderate}, low ${sev.low}, info ${sev.info}`;
  // Informativo: nunca bloquea; se marca warn si hay crit/high.
  const status = sev.critical > 0 || sev.high > 0 ? 'warn' : 'ok';
  addGate(
    `npm audit (${label})`,
    status,
    total === 0 ? 'Sin vulnerabilidades.' : detail + ' (informativo).',
  );
}

// ---------------------------------------------------------------------------
// 6. Chequeo de DDL / esquema en el diff — puede marcar GO-CONDICIONADO
// ---------------------------------------------------------------------------
const SCHEMA_RE = /\b(ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|ADD\s+COLUMN|DROP\s+COLUMN|RENAME\s+COLUMN|CREATE\s+INDEX)\b/i;
function checkSchema() {
  // Lista de archivos cambiados vs base.
  const diffFiles = run('git', ['diff', '--name-only', `${baseRef}...HEAD`]);
  if (diffFiles.code !== 0) {
    // Fallback: diff contra base directo (sin merge-base) o rango vacío.
    const alt = run('git', ['diff', '--name-only', baseRef]);
    if (alt.code !== 0) {
      addGate(
        'Chequeo de esquema/DDL',
        'warn',
        `No se pudo calcular el diff contra ${baseRef}. Verifique manualmente.`,
      );
      return;
    }
  }
  const files = (diffFiles.stdout || '')
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);

  // ¿El diff toca el schema.prisma?
  const touchesPrismaSchema = files.some((f) =>
    /prisma\/schema\.prisma$/.test(f),
  );
  // ¿Trae algún .sql (script DDL manual) o migración?
  const bringsSql = files.some(
    (f) => f.endsWith('.sql') || /prisma\/migrations\//.test(f),
  );

  // Busca sentencias DDL en el CONTENIDO agregado del diff (líneas '+').
  const diffContent = run('git', ['diff', `${baseRef}...HEAD`]);
  const addedLines = (diffContent.stdout || '')
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  const ddlInCode = addedLines.filter((l) => SCHEMA_RE.test(l));

  const schemaChangeDetected = touchesPrismaSchema || ddlInCode.length > 0;

  if (!schemaChangeDetected) {
    addGate(
      'Chequeo de esquema/DDL',
      'ok',
      'No se detectaron cambios de esquema en el rango.',
    );
    return;
  }

  if (bringsSql) {
    addGate(
      'Chequeo de esquema/DDL',
      'warn',
      'Hay cambios de esquema Y se adjunta script SQL/migración. Ejecutar el DDL en la ventana de promoción (en prod NO se corre prisma migrate).',
      ['Aplicar el DDL adjunto a mano en prod, con backup previo.'],
    );
  } else {
    const sample = ddlInCode.slice(0, 3).map((l) => l.trim()).join(' | ');
    addGate(
      'Chequeo de esquema/DDL',
      'warn',
      `Cambios de esquema en código SIN script SQL en el PR${
        touchesPrismaSchema ? ' (toca prisma/schema.prisma)' : ''
      }${sample ? `. Ej.: ${sample}` : '.'}`,
      [
        'GO-CONDICIONADO: correr el DDL manual en prod (en prod NO se corre prisma migrate).',
        'Adjuntar el script DDL exacto en el PR o a la ventana de promoción.',
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// 7. Regresión de tools MCP — el conteo declarado en mcp/test no debe cambiar
//    sin actualizar las pruebas. (Las pruebas del MCP ya validan esto; aquí
//    solo damos visibilidad al número esperado.)
// ---------------------------------------------------------------------------
function checkMcpToolsSurface() {
  const toolsTest = join(ROOT, 'mcp', 'test', 'tools.test.ts');
  if (!existsSync(toolsTest)) {
    addGate(
      'Regresión de tools MCP',
      'warn',
      'No se encontró mcp/test/tools.test.ts.',
    );
    return;
  }
  const grep = run('grep', ['-oE', 'totalTools\\).toBe\\([0-9]+\\)', toolsTest]);
  const m = (grep.stdout || '').match(/toBe\((\d+)\)/);
  const expected = m ? m[1] : '¿?';
  // Si las pruebas del MCP pasaron (gate 4), el contrato de tools está intacto.
  const mcpGate = gates.find((g) => g.name === 'Pruebas MCP');
  if (mcpGate && mcpGate.status === 'ok') {
    addGate(
      'Regresión de tools MCP',
      'ok',
      `Contrato de tools intacto (${expected} tools; validado por mcp/test).`,
    );
  } else {
    addGate(
      'Regresión de tools MCP',
      'warn',
      `No se pudo confirmar el contrato de tools (se esperaban ${expected}); revisar las pruebas del MCP.`,
      ['Si cambió el nº o nombres de tools, actualizar totalTools/names en mcp/test.'],
    );
  }
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------
console.log('== Compuerta de promoción a producción — front-kronos ==');
console.log(`Base del diff: ${baseRef}${skipBuild ? ' · --skip-build' : ''}\n`);

checkTsc();
checkLint();
checkFrontTests();
checkMcpTests();
summarizeAudit(ROOT, 'raíz');
if (existsSync(join(ROOT, 'mcp'))) summarizeAudit(join(ROOT, 'mcp'), 'mcp');
checkSchema();
checkMcpToolsSurface();

// ---------------------------------------------------------------------------
// Veredicto
// ---------------------------------------------------------------------------
const icon = (s) => (s === 'ok' ? OK : s === 'warn' ? WARN : BAD);
const lines = [];
lines.push('## Resumen de compuertas\n');
lines.push('| Compuerta | Estado | Detalle |');
lines.push('|---|---|---|');
for (const g of gates) {
  lines.push(`| ${g.name} | ${icon(g.status)} | ${g.detail} |`);
}

const hasBad = gates.some((g) => g.status === 'bad');
const hasWarnActions = gates.some(
  (g) => g.status === 'warn' && g.actions.length > 0,
);

let verdict, exitCode;
if (hasBad) {
  verdict = 'NO-GO';
  exitCode = 1;
} else if (hasWarnActions) {
  verdict = 'GO-CONDICIONADO';
  exitCode = 0;
} else {
  verdict = 'GO';
  exitCode = 0;
}

const pendingActions = gates
  .filter((g) => g.actions.length > 0)
  .flatMap((g) => g.actions.map((a) => `- (${g.name}) ${a}`));

lines.push('');
lines.push(`## Veredicto: ${verdict}`);
if (pendingActions.length) {
  lines.push('\n### Acciones pendientes');
  lines.push(...pendingActions);
}

const report = lines.join('\n');
console.log('\n' + report + '\n');

// Publica al summary de GitHub Actions si está disponible.
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
  } catch {
    /* ignore */
  }
}

process.exit(exitCode);
