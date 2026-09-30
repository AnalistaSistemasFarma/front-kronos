#!/usr/bin/env node
/**
 * Evidencia de validación del SGC documental.
 *
 * Lee los reportes JUnit que dejan las pruebas (Vitest unitarias e
 * integración, Playwright e2e) bajo `reports/`, extrae el ID de requisito de
 * cada prueba ([SGC-REQ-xxx] en el título) y genera:
 *   - reports/manifest.json                 fecha, commit, rama, corrida, versión
 *   - reports/matriz-trazabilidad-sgc.json  requisito → pruebas → resultado
 *   - reports/matriz-trazabilidad-sgc.md    la misma matriz, legible
 *
 * No depende de librerías: el JUnit de Vitest y de Playwright es XML simple.
 * Uso: node scripts/evidencia/sgc-evidencia.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const REPORTS = path.join(ROOT, 'reports');

function git(cmd, fallback) {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

function findJunit(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findJunit(full));
    else if (/junit.*\.xml$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function decode(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Extrae los <testcase> con su resultado (aprobada / fallida / omitida). */
function parseJunit(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const cases = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const body = m[3] ?? '';
    const name = decode(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? '');
    const classname = decode(/\bclassname="([^"]*)"/.exec(attrs)?.[1] ?? '');
    const time = Number(/\btime="([^"]*)"/.exec(attrs)?.[1] ?? 0);
    const result = /<(failure|error)\b/.test(body) ? 'fallida' : /<skipped\b/.test(body) ? 'omitida' : 'aprobada';
    cases.push({ name, classname, time, result, reporte: path.relative(ROOT, file) });
  }
  return cases;
}

const files = findJunit(REPORTS);
const cases = files.flatMap(parseJunit);

const matriz = new Map();
for (const c of cases) {
  const ids = [...c.name.matchAll(/\[(SGC-REQ-\d{3})\]/g)].map((x) => x[1]);
  for (const id of ids) {
    if (!matriz.has(id)) matriz.set(id, []);
    matriz.get(id).push(c);
  }
}

const requisitos = [...matriz.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, pruebas]) => ({
    requisito: id,
    resultado: pruebas.some((p) => p.result === 'fallida')
      ? 'fallida'
      : pruebas.every((p) => p.result === 'omitida')
        ? 'omitida'
        : 'aprobada',
    pruebas: pruebas.map((p) => ({ prueba: p.name, suite: p.classname, resultado: p.result, reporte: p.reporte })),
  }));

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const manifest = {
  sistema: 'SynerLink — SGC documental',
  version: pkg.version,
  commit: process.env.GITHUB_SHA || git('rev-parse HEAD', 'desconocido'),
  rama: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || git('rev-parse --abbrev-ref HEAD', 'desconocida'),
  corrida: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : 'local',
  generado_utc: new Date().toISOString(),
  reportes_junit: files.map((f) => path.relative(ROOT, f)),
  totales: {
    pruebas: cases.length,
    aprobadas: cases.filter((c) => c.result === 'aprobada').length,
    fallidas: cases.filter((c) => c.result === 'fallida').length,
    omitidas: cases.filter((c) => c.result === 'omitida').length,
    requisitos_sgc: requisitos.length,
  },
};

fs.mkdirSync(REPORTS, { recursive: true });
fs.writeFileSync(path.join(REPORTS, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(REPORTS, 'matriz-trazabilidad-sgc.json'), JSON.stringify({ manifest, requisitos }, null, 2));

const md = [
  '# Matriz de trazabilidad — SGC documental',
  '',
  `- Commit: \`${manifest.commit}\` · Rama: \`${manifest.rama}\``,
  `- Generado (UTC): ${manifest.generado_utc}`,
  `- Corrida: ${manifest.corrida}`,
  `- Pruebas: ${manifest.totales.pruebas} (aprobadas ${manifest.totales.aprobadas}, fallidas ${manifest.totales.fallidas}, omitidas ${manifest.totales.omitidas})`,
  '',
  '| Requisito | Resultado | Prueba | Reporte |',
  '|---|---|---|---|',
  ...requisitos.flatMap((r) =>
    r.pruebas.map((p) => `| ${r.requisito} | ${p.resultado} | ${p.prueba.replace(/\|/g, '\\|')} | ${p.reporte} |`)
  ),
  '',
].join('\n');
fs.writeFileSync(path.join(REPORTS, 'matriz-trazabilidad-sgc.md'), md);

console.log(`Evidencia SGC: ${requisitos.length} requisitos, ${cases.length} pruebas en ${files.length} reportes JUnit.`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${md}\n`);
