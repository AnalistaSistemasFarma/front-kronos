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
});
