import { describe, expect, it } from 'vitest';
import {
  construirConfig,
  filasCopiaInicial,
  isProjectsConfigMarkerSubprocess,
  parsearPerfiles,
  PROJECTS_CONFIG_URL,
  serializarPerfiles,
  validarCambio,
  type FilaConfigAgente,
} from '../config-agentes-rules';
import { isHubHiddenRequestDashboardSubprocess } from '../../request-general/dashboardRoutes';

/*
 * Configuración de «Proyectos» por empresa (pedido de Nicolás Rivera del 2026-10-20).
 * Lo central es la COMPATIBILIDAD: una empresa sin filas sigue con CHAT_PROJECTS_AGENTS,
 * y una empresa con filas obedece a la tabla (sin fila = no habilitado).
 */
const ENV = new Map<string, string[]>([
  ['play', ['olp', 'comex-latam']],
  ['horus', ['gss']],
]);
const OLP = 3;
const GSS = 8;
const fila = (over: Partial<FilaConfigAgente>): FilaConfigAgente => ({ idCompany: OLP, idAgent: 21, code: 'play', enabled: true, profiles: 'olp', ...over });

describe('quién manda', () => {
  it('sin filas: todo como antes del pase (solo el .env)', () => {
    const c = construirConfig([], ENV);
    expect(c.origen(OLP)).toBe('env');
    expect(c.perfiles('play', OLP)).toEqual(['olp', 'comex-latam']);
    expect(c.perfiles('PLAY', GSS)).toEqual(['olp', 'comex-latam']);
    expect(c.habilitado('horus', OLP)).toBe(true);
    expect(c.habilitado('lunaris', OLP)).toBe(false);
    expect(c.habilitadoEnAlguna('play')).toBe(true);
    expect(c.habilitadoEnAlguna('lunaris')).toBe(false);
    // Los filtros del puente quedan idénticos a los de antes.
    expect(c.filtroEmpresas('play')).toEqual({});
    expect(c.filtroAtendible('play')).toEqual({ profile: { in: ['olp', 'comex-latam'] } });
  });

  it('con filas en una empresa: ahí manda la tabla; las demás siguen con el .env', () => {
    const c = construirConfig([fila({ profiles: 'olp' })], ENV);
    expect(c.origen(OLP)).toBe('tabla');
    expect(c.perfiles('play', OLP)).toEqual(['olp']);
    // horus no tiene fila en OLP: con la tabla mandando, no está habilitado ahí.
    expect(c.habilitado('horus', OLP)).toBe(false);
    // GSS no está configurada: sigue el .env.
    expect(c.origen(GSS)).toBe('env');
    expect(c.perfiles('horus', GSS)).toEqual(['gss']);
    expect(c.perfiles('play', GSS)).toEqual(['olp', 'comex-latam']);
  });

  it('deshabilitar en la tabla apaga al agente SOLO en esa empresa', () => {
    const c = construirConfig([fila({ enabled: false })], ENV);
    expect(c.habilitado('play', OLP)).toBe(false);
    expect(c.habilitado('play', GSS)).toBe(true);
    expect(c.habilitadoEnAlguna('play')).toBe(true);
  });

  it('habilitar en la tabla a un agente que el .env no tiene', () => {
    const c = construirConfig([fila({ idAgent: 40, code: 'lunaris', profiles: 'gss,olp' , idCompany: GSS })], ENV);
    expect(c.perfiles('lunaris', GSS)).toEqual(['gss', 'olp']);
    expect(c.habilitado('lunaris', OLP)).toBe(false);
    expect(c.habilitadoEnAlguna('lunaris')).toBe(true);
    expect(c.filtroEmpresas('lunaris')).toEqual({ id_company: { in: [GSS] } });
    expect(c.filtroAtendible('lunaris')).toEqual({ id_company: GSS, profile: { in: ['gss', 'olp'] } });
  });

  it('fila habilitada sin perfiles propios usa los del .env; sin ninguno, no habilita', () => {
    expect(construirConfig([fila({ profiles: null })], ENV).perfiles('play', OLP)).toEqual(['olp', 'comex-latam']);
    expect(construirConfig([fila({ code: 'lunaris', profiles: null })], ENV).habilitado('lunaris', OLP)).toBe(false);
  });

  it('un perfil desconocido en la tabla se ignora (falla cerrado)', () => {
    const c = construirConfig([fila({ profiles: 'olp,perfil-inventado' })], ENV);
    expect(c.perfiles('play', OLP)).toEqual(['olp']);
  });

  it('filtros del puente con empresas mezcladas: tabla donde está configurada, .env en el resto', () => {
    const c = construirConfig([fila({ profiles: 'olp' }), fila({ idCompany: GSS, code: 'horus', idAgent: 1, profiles: 'gss' })], ENV);
    expect(c.filtroEmpresas('play')).toEqual({ OR: [{ id_company: { in: [OLP] } }, { id_company: { notIn: [OLP, GSS] } }] });
    expect(c.filtroAtendible('play')).toEqual({
      OR: [
        { id_company: OLP, profile: { in: ['olp'] } },
        { id_company: { notIn: [OLP, GSS] }, profile: { in: ['olp', 'comex-latam'] } },
      ],
    });
    // Un agente apagado en todas partes: el filtro no deja pasar ningún proyecto.
    const apagado = construirConfig([fila({ enabled: false, code: 'lunaris' })], new Map());
    expect(apagado.filtroEmpresas('lunaris')).toEqual({ id_project: { in: [] } });
    expect(apagado.filtroAtendible('lunaris')).toEqual({ id_project: { in: [] } });
    expect(apagado.filtroEmpresas('')).toEqual({ id_project: { in: [] } });
  });
});

describe('perfiles en la columna', () => {
  it('lee solo claves conocidas, sin repetir; null = heredar del .env', () => {
    expect(parsearPerfiles(null)).toBeNull();
    expect(parsearPerfiles(' olp , gss,olp,x ')).toEqual(['olp', 'gss']);
    expect(serializarPerfiles(['olp', 'gss'])).toBe('olp,gss');
    expect(serializarPerfiles([])).toBeNull();
  });
});

describe('validarCambio', () => {
  const base = { company: 3, idAgent: 21, enabled: true, profiles: ['olp'], reason: 'Comex lo pidió el 2026-10-20' };

  it('acepta un cambio completo (y la empresa como texto)', () => {
    const v = validarCambio({ ...base, company: '3' });
    expect(v).toEqual({ ok: true, value: { idCompany: 3, idAgent: 21, enabled: true, profiles: ['olp'], reason: 'Comex lo pidió el 2026-10-20' } });
  });

  it('exige motivo, empresa, asistente y booleano', () => {
    expect(validarCambio({ ...base, reason: '  ok ' }).ok).toBe(false);
    expect(validarCambio({ ...base, reason: 'x'.repeat(501) }).ok).toBe(false);
    expect(validarCambio({ ...base, company: 0 }).ok).toBe(false);
    expect(validarCambio({ ...base, idAgent: '21' }).ok).toBe(false);
    expect(validarCambio({ ...base, enabled: 'si' }).ok).toBe(false);
  });

  it('habilitar exige al menos un perfil, y todos del catálogo', () => {
    expect(validarCambio({ ...base, profiles: [] }).ok).toBe(false);
    expect(validarCambio({ ...base, profiles: ['olp', 'inventado'] }).ok).toBe(false);
    expect(validarCambio({ ...base, enabled: false, profiles: [] }).ok).toBe(true);
  });
});

describe('copia inicial del .env', () => {
  it('copia los agentes de la empresa que el .env habilitaba, menos el que se cambia', () => {
    const agentes = [
      { idAgent: 21, code: 'play' },
      { idAgent: 1, code: 'Horus' },
      { idAgent: 40, code: 'lunaris' },
    ];
    expect(filasCopiaInicial(agentes, ENV, 21)).toEqual([{ idAgent: 1, profiles: ['gss'] }]);
    expect(filasCopiaInicial(agentes, ENV, 40)).toEqual([
      { idAgent: 21, profiles: ['olp', 'comex-latam'] },
      { idAgent: 1, profiles: ['gss'] },
    ]);
  });
});

describe('permiso (marcador)', () => {
  it('es /process/proyectos/configuracion y no se lista en el menú', () => {
    expect(PROJECTS_CONFIG_URL).toBe('/process/proyectos/configuracion');
    expect(isProjectsConfigMarkerSubprocess({ subprocess_url: ' /process/proyectos/configuracion ' })).toBe(true);
    expect(isProjectsConfigMarkerSubprocess({ subprocess_url: '/process/proyectos' })).toBe(false);
    expect(isHubHiddenRequestDashboardSubprocess({ subprocess: 'Configuración de Proyectos', subprocess_url: PROJECTS_CONFIG_URL })).toBe(true);
    expect(isHubHiddenRequestDashboardSubprocess({ subprocess: 'Proyectos', subprocess_url: '/process/proyectos' })).toBe(false);
  });
});
