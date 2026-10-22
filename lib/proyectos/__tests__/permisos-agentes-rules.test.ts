import { describe, expect, it, vi } from 'vitest';
import {
  cargarOperadoresPases,
  isPermisosAgentesMarkerSubprocess,
  mismaPolitica,
  NIVEL_INFO,
  nivelDesdeDb,
  normalizarMotivo,
  normalizarPolitica,
  normalizarRepoCatalogo,
  OPERADORES_PASES_POR_DEFECTO,
  parsearCorreos,
  PERMISOS_AGENTES_URL,
  resumenPolitica,
  serializarCorreos,
} from '../permisos-agentes-rules';
import { isHubHiddenRequestDashboardSubprocess } from '../../request-general/dashboardRoutes';

/*
 * Permisos de los agentes (2026-10-20): reglas puras. Lo importante:
 *   - el valor seguro por defecto es «ninguno» y sin repos;
 *   - solo repos del catálogo ACTIVO;
 *   - los pases solo los autorizan los operadores autorizados (Nicolás y Cristian);
 *   - todo cambio exige motivo;
 *   - el subproceso-permiso es un marcador que no sale en el menú.
 */
const ctx = { catalogoActivo: ['front-kronos', 'sapsend'], operadores: [...OPERADORES_PASES_POR_DEFECTO] };

describe('normalizarPolitica', () => {
  it('«ninguno» descarta repos y autorizadores', () => {
    const r = normalizarPolitica({ codeLevel: 'ninguno', repos: ['sapsend'], deployApprovers: ['nicolas.rivera@gsslatam.com'] }, ctx);
    expect(r).toEqual({ ok: true, value: { codeLevel: 'ninguno', repos: [], deployApprovers: [] } });
  });

  it('lectura y desarrollo exigen repos del catálogo ACTIVO, sin duplicados', () => {
    expect(normalizarPolitica({ codeLevel: 'lectura', repos: [] }, ctx)).toMatchObject({ ok: false });
    expect(normalizarPolitica({ codeLevel: 'desarrollo', repos: ['mcp-sapbo'] }, ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/catálogo/) });
    expect(normalizarPolitica({ codeLevel: 'desarrollo', repos: ['../x'] }, ctx)).toMatchObject({ ok: false });
    const r = normalizarPolitica({ codeLevel: 'desarrollo', repos: ['SAPSEND', 'sapsend'], deployApprovers: ['x@y.com'] }, ctx);
    expect(r).toEqual({ ok: true, value: { codeLevel: 'desarrollo', repos: ['sapsend'], deployApprovers: [] } });
  });

  it('pases: por defecto TODOS los operadores; solo operadores; nadie más', () => {
    const def = normalizarPolitica({ codeLevel: 'desarrollo_pases', repos: ['sapsend'] }, ctx);
    expect(def).toEqual({
      ok: true,
      value: { codeLevel: 'desarrollo_pases', repos: ['sapsend'], deployApprovers: ['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com'] },
    });
    const uno = normalizarPolitica({ codeLevel: 'desarrollo_pases', repos: ['sapsend'], deployApprovers: ['Cristian.Baldion@gsslatam.com'] }, ctx);
    expect(uno).toMatchObject({ ok: true, value: { deployApprovers: ['cristian.baldion@gsslatam.com'] } });
    const intruso = normalizarPolitica({ codeLevel: 'desarrollo_pases', repos: ['sapsend'], deployApprovers: ['nicolas.rojas@gsslatam.com'] }, ctx);
    expect(intruso).toMatchObject({ ok: false, error: expect.stringMatching(/operadores autorizados/) });
  });

  it('nivel desconocido o cuerpo inválido', () => {
    expect(normalizarPolitica({ codeLevel: 'admin' }, ctx)).toMatchObject({ ok: false });
    expect(normalizarPolitica(null, ctx)).toMatchObject({ ok: false });
    expect(normalizarPolitica({ codeLevel: 'lectura', repos: 'sapsend' }, ctx)).toMatchObject({ ok: false });
  });
});

describe('motivo, catálogo y utilidades', () => {
  it('el motivo es obligatorio y acotado', () => {
    expect(normalizarMotivo('corto')).toMatchObject({ ok: false });
    expect(normalizarMotivo('  Nicolás lo aprobó por Telegram.  ')).toEqual({ ok: true, value: 'Nicolás lo aprobó por Telegram.' });
    expect(normalizarMotivo('x'.repeat(501))).toMatchObject({ ok: false });
  });

  it('repo del catálogo: clave, «dueño/repo» y ramas distintas', () => {
    const ok = normalizarRepoCatalogo({ slug: 'mcp-sapbo', name: 'MCP SAP', github: 'gsslatam/mcp-sapbo', branchTesting: 'testing', branchProduction: 'main' });
    expect(ok).toMatchObject({ ok: true, value: { slug: 'mcp-sapbo', description: null } });
    expect(normalizarRepoCatalogo({ slug: 'Mal Slug', name: 'x', github: 'a/b', branchTesting: 't', branchProduction: 'm' })).toMatchObject({ ok: false });
    expect(normalizarRepoCatalogo({ slug: 'x', name: 'x', github: 'sin-barra', branchTesting: 't', branchProduction: 'm' })).toMatchObject({ ok: false });
    expect(normalizarRepoCatalogo({ slug: 'x', name: 'x', github: 'a/b', branchTesting: 'main', branchProduction: 'main' })).toMatchObject({ ok: false });
    // Al editar no se valida la clave (no cambia).
    expect(normalizarRepoCatalogo({ name: 'x', github: 'a/b', branchTesting: 't', branchProduction: 'm' }, { editando: true })).toMatchObject({ ok: true });
  });

  it('nivel guardado desconocido = «ninguno»; los números son los del puente', () => {
    expect(nivelDesdeDb('root')).toBe('ninguno');
    expect(nivelDesdeDb(null)).toBe('ninguno');
    expect([NIVEL_INFO.ninguno.numero, NIVEL_INFO.lectura.numero, NIVEL_INFO.desarrollo.numero, NIVEL_INFO.desarrollo_pases.numero]).toEqual([0, 1, 2, 3]);
  });

  it('correos ida y vuelta; mismaPolitica ignora el orden; resumen legible', () => {
    expect(parsearCorreos(serializarCorreos(['a@b.co', 'c@d.co']))).toEqual(['a@b.co', 'c@d.co']);
    expect(serializarCorreos([])).toBeNull();
    expect(parsearCorreos('malo, a@b.co ,a@b.co')).toEqual(['a@b.co']);
    expect(mismaPolitica({ codeLevel: 'lectura', repos: ['a', 'b'], deployApprovers: [] }, { codeLevel: 'lectura', repos: ['b', 'a'], deployApprovers: [] })).toBe(true);
    expect(mismaPolitica({ codeLevel: 'lectura', repos: ['a'], deployApprovers: [] }, { codeLevel: 'desarrollo', repos: ['a'], deployApprovers: [] })).toBe(false);
    expect(resumenPolitica({ codeLevel: 'desarrollo_pases', repos: ['sapsend'], deployApprovers: ['n@g.co'] })).toBe('Desarrollo + pases · sapsend · pases: n@g.co');
  });

  it('operadores: por defecto Nicolás y Cristian; el .env los cambia; inválido = por defecto', () => {
    expect(cargarOperadoresPases({} as NodeJS.ProcessEnv).map((o) => o.email)).toEqual(['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com']);
    const env = { PROYECTOS_OPERADORES_PASES: JSON.stringify([{ email: 'Alexander@GSSLATAM.com', name: 'Alexander' }]) } as unknown as NodeJS.ProcessEnv;
    expect(cargarOperadoresPases(env)).toEqual([{ email: 'alexander@gsslatam.com', name: 'Alexander' }]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(cargarOperadoresPases({ PROYECTOS_OPERADORES_PASES: '[]' } as unknown as NodeJS.ProcessEnv)).toHaveLength(2);
    expect(cargarOperadoresPases({ PROYECTOS_OPERADORES_PASES: '{' } as unknown as NodeJS.ProcessEnv)).toHaveLength(2);
    spy.mockRestore();
  });

  it('el subproceso-permiso es un marcador oculto del menú', () => {
    expect(isPermisosAgentesMarkerSubprocess({ subprocess_url: PERMISOS_AGENTES_URL })).toBe(true);
    expect(isPermisosAgentesMarkerSubprocess({ subprocess_url: '/process/proyectos' })).toBe(false);
    expect(isHubHiddenRequestDashboardSubprocess({ subprocess_url: '/process/proyectos/permisos-agentes' })).toBe(true);
    expect(isHubHiddenRequestDashboardSubprocess({ subprocess_url: '/process/proyectos' })).toBe(false);
  });
});
