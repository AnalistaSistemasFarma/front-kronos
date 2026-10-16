import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Aislamiento del sistema validado (plan, principio 1 y 2): el código del SGC
 * solo comparte lo mínimo con SynerLink general (usuarios/sesión, Prisma, la
 * utilidad de OneDrive y componentes base). Nada de Orión, chat, solicitudes
 * generales, workflows ni SAPSEND, que siguen en desarrollo activo.
 */
const ROOT = process.cwd();
const DIRS = ['lib/sgc', 'components/sgc', 'app/api/sgc', 'app/(hub)/process/sgc-documental'];
const FORBIDDEN = [/orion/i, /\/chat\//, /requests?-general/, /\/workflow\//, /sapsend/i, /document-management/];
// Sprint 2: autorizaciones y administrador de workflows de SynerLink general
// (el SGC tiene los suyos, copiados y congelados, en tablas propias).
const FORBIDDEN_S2 = [/process\/authorization/, /api\/authorization\//, /authorization-types\/route/, /admin-workflow/, /view-workflows/, /workflow-administration/];
// Uso en código (no en comentarios) de las tablas o modelos de los flujos,
// solicitudes y autorizaciones generales.
const FORBIDDEN_DATA = [
  /\.(typesAuthorization|userTypesAuthorization|requestsGeneral|taskRequestGeneral|processCategory|taskProcessCategory)\b/,
  /\b(?:FROM|JOIN|INTO|UPDATE) +(?:dbo\.|\[dbo\]\.)?\[?(?:types_authorization|user_types_authorization|requests_general|task_request_general|user_task_request_general|process_category|task_process_category|process_form_field|request_form_value|notes)\b/i,
];

function files(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : files(rel);
    return /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
  });
}

describe('SGC · aislamiento del código validado', () => {
  it('[SGC-REQ-001] el código del SGC no importa módulos de SynerLink en desarrollo activo (Orión, chat, solicitudes, workflows, SAPSEND)', () => {
    const offenders: string[] = [];
    const all = DIRS.flatMap(files);
    expect(all.length).toBeGreaterThan(20);
    for (const f of all) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const spec = m[1] ?? m[2];
        if (FORBIDDEN.some((re) => re.test(spec))) offenders.push(`${f} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('[SGC-REQ-033] el motor de flujos, las Tareas documentales y las Autorizaciones SGC no usan el código ni las tablas de SynerLink general', () => {
    const offenders: string[] = [];
    for (const f of DIRS.flatMap(files)) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const spec = m[1] ?? m[2];
        if (FORBIDDEN_S2.some((re) => re.test(spec))) offenders.push(`${f} → ${spec}`);
      }
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const re of FORBIDDEN_DATA) {
        const hit = code.match(re);
        if (hit) offenders.push(`${f} → ${hit[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('[SGC-REQ-049] la firma electrónica del SGC es independiente de Orión: sin imports de lib/orion ni components/orion, sin ORION_*, sin el tenant farmalogica-1 ni tablas de Orión', () => {
    const offenders: string[] = [];
    const all = DIRS.flatMap(files);
    const signatureFiles = all.filter((f) => /signature|pdf|draft/.test(f));
    expect(signatureFiles.length).toBeGreaterThan(8);
    for (const f of all) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const spec = m[1] ?? m[2] ?? m[3];
        if (/lib\/orion|components\/orion|integrations\/orion/i.test(spec)) offenders.push(`${f} → ${spec}`);
      }
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const re of [/ORION_[A-Z_]+/, /farmalogica-1/i, /orion_document_event|orionDocumentEvent/i, /\/api\/integrations\/orion/i]) {
        const hit = code.match(re);
        if (hit) offenders.push(`${f} → ${hit[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
