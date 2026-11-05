import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Formación debe verse IGUAL que «Solicitudes y Tareas Asignadas» (Nicolás
 * Rivera, 2026-10-26: «no puede tener otros estilos distintos»). Esta prueba
 * falla si alguna pantalla de Formación vuelve a usar clases o estilos propios:
 * solo se permiten `RequestListUi`, `requestList.module.css`, los paneles y Mantine.
 */
const raiz = join(__dirname, '..', '..', '..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
const leer = (f: string) => readFileSync(join(raiz, f), 'utf8');

const ARCHIVOS = [
  'components/portal/PortalFormacion.tsx',
  'components/portal/TopEstudiantes.tsx',
  'app/portal/formacion/page.tsx',
  'app/(hub)/process/formacion/page.tsx',
  ...readdirSync(join(raiz, 'components', 'formacion'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `components/formacion/${f}`),
];

describe('Formación · mismos lineamientos gráficos que Solicitudes y Tareas', () => {
  it.each(ARCHIVOS)('%s no usa las clases propias del portal (portal-th__)', (f) => {
    expect(leer(f)).not.toMatch(/portal-th/);
  });

  it.each(ARCHIVOS)('%s no importa hojas de estilo propias', (f) => {
    const css = leer(f)
      .split('\n')
      .filter((l) => l.startsWith('import') && l.includes(".css'"))
      .map((l) => l.slice(l.indexOf("'") + 1, l.lastIndexOf("'")));
    for (const c of css) expect(c).toMatch(/requestList\.module\.css$|panel\.module\.css$/);
  });

  it('el módulo usa las piezas de la pantalla de referencia', () => {
    const modulo = leer('components/formacion/ModuloFormacion.tsx');
    for (const pieza of ['RequestsPage', 'RequestsHeader', 'StatFilterTile', 'ProgressRingTile', 'FilterPanel', 'statGrid', 'SegmentedControl']) {
      expect(modulo).toContain(pieza);
    }
  });
});
