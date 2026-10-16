import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormacionStorageError, FormacionStorageNoConfigurado, _reiniciarCacheToken } from '../formacion-storage';
import { TITULO_CUMPLEANOS, cumpleanosComoEventos } from '../calendario';
import {
  CUMPLEANOS_CACHE_MS,
  RUTA_BASE_PERSONAL_POR_DEFECTO,
  _reiniciarCacheCumpleanos,
  cumpleanosEnRango,
  diaMesDeNacimiento,
  leerConfigCumpleanos,
  leerPersonasConCumple,
  personasDesdeHojaCumple,
  ubicarColumnasCumple,
  type ConfigCumpleanos,
} from '../cumpleanos';

// Cumpleaños en el calendario del portal (Cristian Baldión, 2026-10-15). Graph SIMULADO; las personas son inventadas.

const HOY = new Date('2026-10-15T12:00:00Z');
const ENV = {
  PORTAL_TH_SP_TENANT_ID: 't',
  PORTAL_TH_SP_CLIENT_ID: 'c',
  PORTAL_TH_SP_CLIENT_SECRET: '***',
  PORTAL_TH_SP_SITE_ID: 'gsslatam.sharepoint.com,1,2',
} as unknown as NodeJS.ProcessEnv;
const CFG: ConfigCumpleanos = { tenantId: 't', clientId: 'c', clientSecret: '***', siteId: 'gsslatam.sharepoint.com,1,2', ruta: ['CONTACTOS', 'BASE PERSONAL.xlsx'] };
const ENC = ['Empresa', 'Cédula', 'Apellidos y Nombres', 'Empresa contratante', 'Área / Dependencia', 'Cargo', 'Correo corporativo', 'Fecha de nacimiento', 'Estado Activo SI/ NO'];
// 31/10/1990 = serie 33178 · 15/10/1985 = 31335 · 29/02/1988 = 32202
const serie = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000);
const HOJA = [
  ENC,
  ['GSS', '1010101010', 'PEREZ GOMEZ ANA', 'GROUP SHARED SERVICES SAS', 'SISTEMAS', 'ANALISTA', 'a@x.com', serie('1990-10-15'), 'SI'],
  ['GSS', '2020202020', 'ACOSTA RUIZ LUIS', 'GROUP SHARED SERVICES SAS', 'CONTABILIDAD', 'JEFE', '', serie('1985-10-15'), 'SI'],
  ['Ryan', '3030303030', 'MORA PINTO JUAN', 'LABORATORIO RYAN DE COLOMBIA S.A.S', 'PRODUCCION', 'AUXILIAR', '', serie('1988-02-29'), 'SI'],
  ['Ryan', '4040404040', 'INACTIVO SIN EMPLEO', 'RYAN', 'X', 'X', '', serie('1990-10-15'), 'NO'],
  ['Ryan', '5050505050', 'FECHA ROTA', 'RYAN', 'X', 'X', '', 'sin fecha', 'SI'],
  ['Ryan', '6060606060', '', 'RYAN', 'X', 'X', '', serie('1990-10-15'), 'SI'],
];
const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status });

function graphFalso(valores: unknown[][] = HOJA, fallo?: (u: string) => Response | null) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.startsWith('https://login.microsoftonline.com/')) return json(200, { access_token: '***', expires_in: 3600 });
    const f = fallo?.(u);
    if (f) return f;
    if (u.includes('/drive/root:/CONTACTOS/BASE%20PERSONAL.xlsx:?')) return json(200, { id: '01ABC' });
    if (u.includes('/workbook/worksheets?')) return json(200, { value: [{ name: 'Maestra' }] });
    if (u.includes('/usedRange?')) return json(200, { values: valores });
    return json(404, {});
  });
}

beforeEach(() => {
  _reiniciarCacheToken();
  _reiniciarCacheCumpleanos();
});

describe('leerConfigCumpleanos', () => {
  it('por defecto lee CONTACTOS/BASE PERSONAL.xlsx con la misma app de Formación; rutas peligrosas se rechazan', () => {
    expect(RUTA_BASE_PERSONAL_POR_DEFECTO).toBe('CONTACTOS/BASE PERSONAL.xlsx');
    expect(leerConfigCumpleanos(ENV).ruta).toEqual(['CONTACTOS', 'BASE PERSONAL.xlsx']);
    expect(leerConfigCumpleanos({ ...ENV, PORTAL_TH_SP_BASE_PERSONAL: 'OTRA/Base.xlsx' } as NodeJS.ProcessEnv).ruta).toEqual(['OTRA', 'Base.xlsx']);
    for (const mala of ['..', '../x.xlsx', 'A//B.xlsx', '/A.xlsx', 'A:B.xlsx', 'A/B/C/D/E.xlsx']) {
      expect(() => leerConfigCumpleanos({ ...ENV, PORTAL_TH_SP_BASE_PERSONAL: mala } as NodeJS.ProcessEnv), mala).toThrow(FormacionStorageNoConfigurado);
    }
    expect(() => leerConfigCumpleanos({} as NodeJS.ProcessEnv)).toThrow(FormacionStorageNoConfigurado);
  });
});

describe('diaMesDeNacimiento', () => {
  it('lee el número de serie de Excel (lo normal) y devuelve solo día y mes', () => {
    expect(diaMesDeNacimiento(serie('1990-10-15'), HOY)).toEqual({ mes: 10, dia: 15 });
    expect(diaMesDeNacimiento(serie('1988-02-29'), HOY)).toEqual({ mes: 2, dia: 29 });
    expect(Object.keys(diaMesDeNacimiento(serie('1990-10-15'), HOY)!).sort()).toEqual(['dia', 'mes']); // sin año
  });
  it('lee AAAA-MM-DD y D/M/AAAA (en Colombia el día va primero)', () => {
    expect(diaMesDeNacimiento('1990-03-07', HOY)).toEqual({ mes: 3, dia: 7 });
    expect(diaMesDeNacimiento('07/03/1990', HOY)).toEqual({ mes: 3, dia: 7 });
    expect(diaMesDeNacimiento('13/03/1990', HOY)).toEqual({ mes: 3, dia: 13 });
    expect(diaMesDeNacimiento('1990-03-07T00:00:00.000Z', HOY)).toEqual({ mes: 3, dia: 7 });
  });
  it('rechaza lo que no es una fecha de una persona', () => {
    for (const malo of ['', 'sin fecha', '31/02/1990', '1990-13-01', '00/01/1990', '15/10/1850', '15/10/2090', '15/10/90', '1990/1/2/3', null, undefined, true, {}, NaN, 0, -5, 1e9, '2027-01-01']) {
      expect(diaMesDeNacimiento(malo, HOY), String(malo)).toBeNull();
    }
  });
});

describe('columnas', () => {
  it('se ubican por su encabezado aunque cambien de orden, tildes o mayúsculas; sin una necesaria lanza cuál falta', () => {
    expect(ubicarColumnasCumple(['FECHA DE NACIMIENTO', 'area / dependencia', 'Empresa Contratante', 'apellidos y nombres'])).toMatchObject({ nacimiento: 0, area: 1, empresa: 2, nombre: 3, estado: -1 });
    expect(() => ubicarColumnasCumple(['Apellidos y Nombres', 'Empresa contratante', 'Área / Dependencia'])).toThrow(/«FECHA DE NACIMIENTO»/);
    expect(() => ubicarColumnasCumple(['Apellidos y Nombres', 'Área / Dependencia', 'Fecha de nacimiento'])).toThrow(/«EMPRESA CONTRATANTE»/);
  });
});

describe('personasDesdeHojaCumple', () => {
  it('toma nombre, empresa contratante, área y día/mes; descarta inactivos, sin nombre y sin fecha válida (y cuenta estos últimos)', () => {
    const r = personasDesdeHojaCumple(HOJA, HOY);
    expect(r.personas.map((p) => p.nombre)).toEqual(['PEREZ GOMEZ ANA', 'ACOSTA RUIZ LUIS', 'MORA PINTO JUAN']);
    expect(r.sinFechaValida).toBe(1);
    expect(r.personas[0]).toEqual({ nombre: 'PEREZ GOMEZ ANA', empresa: 'GROUP SHARED SERVICES SAS', area: 'SISTEMAS', mes: 10, dia: 15 });
  });
  it('no deja pasar la cédula, el correo ni el cargo, ni el año de nacimiento', () => {
    const texto = JSON.stringify(personasDesdeHojaCumple(HOJA, HOY).personas);
    for (const no of ['1010101010', '2020202020', 'a@x.com', 'ANALISTA', '1990', '1985', '1988']) expect(texto, no).not.toContain(no);
  });
  it('hoja vacía o solo con encabezado: nadie', () => {
    expect(personasDesdeHojaCumple([], HOY)).toEqual({ personas: [], sinFechaValida: 0 });
    expect(personasDesdeHojaCumple([ENC], HOY).personas).toEqual([]);
  });
});

describe('cumpleanosEnRango', () => {
  const personas = personasDesdeHojaCumple(HOJA, HOY).personas;
  it('pone a cada persona en su día y mes, sin importar el año, y ordena por nombre', () => {
    const r = cumpleanosEnRango(personas, '2026-10-12', '2026-10-18');
    expect(r).toHaveLength(1);
    expect(r[0].fecha).toBe('2026-10-15');
    expect(r[0].personas.map((p) => p.nombre)).toEqual(['ACOSTA RUIZ LUIS', 'PEREZ GOMEZ ANA']);
    expect(cumpleanosEnRango(personas, '2031-10-15', '2031-10-15')[0].personas).toHaveLength(2); // cualquier año
  });
  it('solo devuelve nombre, empresa y área', () => {
    expect(Object.keys(cumpleanosEnRango(personas, '2026-10-15', '2026-10-15')[0].personas[0]).sort()).toEqual(['area', 'empresa', 'nombre']);
  });
  it('quien nació un 29 de febrero se celebra el 28 en los años que no son bisiestos y el 29 en los bisiestos', () => {
    expect(cumpleanosEnRango(personas, '2026-02-27', '2026-03-02').map((d) => d.fecha)).toEqual(['2026-02-28']);
    expect(cumpleanosEnRango(personas, '2028-02-27', '2028-03-02').map((d) => d.fecha)).toEqual(['2028-02-29']);
  });
  it('un rango que cruza de año, y un rango inválido o invertido', () => {
    const p = [{ nombre: 'A', empresa: 'E', area: 'X', mes: 1, dia: 1 }, { nombre: 'B', empresa: 'E', area: 'X', mes: 12, dia: 31 }];
    expect(cumpleanosEnRango(p, '2026-12-30', '2027-01-02').map((d) => d.fecha)).toEqual(['2026-12-31', '2027-01-01']);
    expect(cumpleanosEnRango(p, '2026-12-31', '2026-12-01')).toEqual([]);
    expect(cumpleanosEnRango(p, 'x', 'y')).toEqual([]);
  });
  it('sin personas, nada', () => {
    expect(cumpleanosEnRango([], '2026-01-01', '2026-12-31')).toEqual([]);
  });
});

describe('cumpleanosComoEventos (lo que ve el calendario)', () => {
  it('un evento «CUMPLEAÑOS» por día, de tipo fecha importante, con la lista de personas', () => {
    const e = cumpleanosComoEventos([{ fecha: '2026-10-15', personas: [{ nombre: 'A', empresa: 'E', area: 'X' }] }]);
    expect(e).toEqual([{ fecha: '2026-10-15', titulo: 'CUMPLEAÑOS', tipo: 'conmemoracion', personas: [{ nombre: 'A', empresa: 'E', area: 'X' }] }]);
    expect(TITULO_CUMPLEANOS).toBe('CUMPLEAÑOS');
  });
  it('ignora fechas inválidas y días sin personas (la respuesta del servidor no es de fiar)', () => {
    expect(cumpleanosComoEventos([{ fecha: '2026-02-30', personas: [{ nombre: 'A', empresa: 'E', area: 'X' }] }, { fecha: '2026-10-15', personas: [] }, { fecha: 'x', personas: [] }])).toEqual([]);
  });
});

describe('leerPersonasConCumple (Graph simulado)', () => {
  it('abre el archivo, la primera hoja y su rango; solo hace lecturas', async () => {
    const f = graphFalso();
    const p = await leerPersonasConCumple({ config: CFG, fetch: f as unknown as typeof fetch });
    expect(p.length).toBeGreaterThan(0);
    for (const c of f.mock.calls as unknown as [string, RequestInit | undefined][]) {
      if (!String(c[0]).startsWith('https://login.microsoftonline.com/')) expect(c[1]?.method ?? 'GET').toBe('GET');
    }
  });
  it('la guarda en caché cinco minutos y la vuelve a pedir pasado ese tiempo', async () => {
    const f = graphFalso();
    let t = 1_000_000;
    const ahora = () => t;
    await leerPersonasConCumple({ config: CFG, fetch: f as unknown as typeof fetch, ahora });
    const llamadas = f.mock.calls.length;
    await leerPersonasConCumple({ config: CFG, fetch: f as unknown as typeof fetch, ahora });
    expect(f.mock.calls.length).toBe(llamadas);
    t += CUMPLEANOS_CACHE_MS + 1;
    await leerPersonasConCumple({ config: CFG, fetch: f as unknown as typeof fetch, ahora });
    expect(f.mock.calls.length).toBeGreaterThan(llamadas);
  });
  it('errores de Graph: archivo no encontrado, sin permiso, libro sin hojas y hoja sin datos', async () => {
    const e404 = graphFalso(HOJA, (u) => (u.includes('/drive/root:/') ? json(404, {}) : null));
    await expect(leerPersonasConCumple({ config: CFG, fetch: e404 as unknown as typeof fetch })).rejects.toMatchObject({ status: 404 });
    _reiniciarCacheCumpleanos();
    const e403 = graphFalso(HOJA, (u) => (u.includes('/usedRange?') ? json(403, {}) : null));
    await expect(leerPersonasConCumple({ config: CFG, fetch: e403 as unknown as typeof fetch })).rejects.toMatchObject({ status: 403 });
    _reiniciarCacheCumpleanos();
    const sinHojas = graphFalso(HOJA, (u) => (u.includes('/workbook/worksheets?') ? json(200, { value: [] }) : null));
    await expect(leerPersonasConCumple({ config: CFG, fetch: sinHojas as unknown as typeof fetch })).rejects.toBeInstanceOf(FormacionStorageError);
    _reiniciarCacheCumpleanos();
    const sinValores = graphFalso(HOJA, (u) => (u.includes('/usedRange?') ? json(200, {}) : null));
    await expect(leerPersonasConCumple({ config: CFG, fetch: sinValores as unknown as typeof fetch })).rejects.toBeInstanceOf(FormacionStorageError);
  });
});
