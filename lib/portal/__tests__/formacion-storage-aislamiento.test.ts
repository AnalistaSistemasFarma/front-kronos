/* eslint-disable security/detect-non-literal-fs-filename -- recorre el propio repo en una prueba */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AISLAMIENTO del almacenamiento de Formación.
 *
 * La credencial `PORTAL_TH_SP_*` (app SynerLink-PortalTH-Formacion,
 * `Sites.Selected` + write SOLO en el sitio TalentoHumano) es exclusiva de la
 * sección Formación del Portal TH — pedido de Cristian Baldión, 2026-09-30.
 * Si otro módulo de SynerLink (SGC, solicitudes, gestión documental, chat…)
 * empieza a importar `formacion-storage` o a leer esas variables, esta prueba
 * falla a propósito: para otro uso, otra app con su propio alcance.
 */
const RAIZ = path.resolve(__dirname, '../../..');
const PERMITIDOS = [path.join('lib', 'portal') + path.sep, path.join('app', 'api', 'portal') + path.sep];
const CARPETAS = ['app', 'lib', 'components', 'hooks', 'mcp', 'scripts', 'worker', 'middleware.ts'];
const IGNORAR = new Set(['node_modules', '.next', 'generated', 'dist', 'coverage']);

function archivos(ruta: string, salida: string[] = []): string[] {
  let st;
  try {
    st = statSync(ruta);
  } catch {
    return salida;
  }
  if (st.isFile()) {
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(ruta)) salida.push(ruta);
    return salida;
  }
  for (const nombre of readdirSync(ruta)) {
    if (IGNORAR.has(nombre)) continue;
    archivos(path.join(ruta, nombre), salida);
  }
  return salida;
}

describe('formacion-storage solo se usa desde el Portal TH', () => {
  it('nadie fuera de lib/portal y app/api/portal lo importa ni lee PORTAL_TH_SP_*', () => {
    const infractores = CARPETAS.flatMap((c) => archivos(path.join(RAIZ, c)))
      .map((f) => ({ f, rel: path.relative(RAIZ, f) }))
      .filter(({ rel }) => !PERMITIDOS.some((p) => rel.startsWith(p)))
      .filter(({ f }) => {
        const texto = readFileSync(f, 'utf8');
        return /formacion-storage/.test(texto) || /PORTAL_TH_SP_/.test(texto);
      })
      .map(({ rel }) => rel);
    expect(infractores).toEqual([]);
  });
});
