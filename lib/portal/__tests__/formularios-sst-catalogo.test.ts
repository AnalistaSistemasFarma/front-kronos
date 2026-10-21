import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormacionStorageError, _reiniciarCacheToken } from '../formacion-storage';
import { FORMULARIOS_SST, MAX_FORMULARIOS_SST_PERSONALIZADOS } from '../formularios-sst';
import {
  CARPETA_DEFINICIONES_SST,
  CATALOGO_CACHE_MS,
  ErrorCatalogoSst,
  _reiniciarCacheCatalogoSst,
  catalogoParaAdministrar,
  formularioSstActual,
  guardarDefinicionSst,
  listarFormulariosSst,
  retirarFormularioSst,
} from '../formularios-sst-catalogo';
import type { ConfigFormulariosSst } from '../formularios-sst-servidor';

// Catálogo de formularios SST (Cristian Baldión, 2026-10-20). SharePoint SIMULADO con un almacén en memoria.

const CFG: ConfigFormulariosSst = { tenantId: 't', clientId: 'c', clientSecret: '***', siteId: 'gsslatam.sharepoint.com,1,2', carpeta: 'FORMULARIOS SST' };
const [REPORTE, SALUD] = FORMULARIOS_SST;
const ADMIN = 'Cristian.Baldion@gsslatam.com';
/** 20 de octubre de 2026, 10:00 hora de Colombia. */
const T0 = new Date(Date.UTC(2026, 9, 20, 15, 0, 0));
const RUTA = (codigo: string, marca: string) => `FORMULARIOS SST/${CARPETA_DEFINICIONES_SST}/${codigo}/${marca}.json`;

const def = (codigo = 'SST-NUEVO', extra: Record<string, unknown> = {}) => ({
  formato: 1,
  codigo,
  titulo: 'Reporte nuevo',
  preguntas: [{ id: 'q1', texto: '¿Qué ocurrió?', tipo: 'texto_largo', obligatoria: true }],
  ...extra,
});

/** Un SharePoint de mentira: guarda, lista (con carpetas), lee y borra archivos por ruta. */
function sharePointFalso() {
  const archivos = new Map<string, string>();
  const llamadas: { metodo: string; ruta: string }[] = [];
  let caido: number | null = null;
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('https://login.microsoftonline.com/')) return new Response(JSON.stringify({ access_token: '***', expires_in: 3600 }), { status: 200 });
    if (caido !== null) return new Response('{}', { status: caido });
    const marca = 'drive/root:/';
    const inicio = u.indexOf(marca);
    if (inicio < 0) return new Response('{}', { status: 404 });
    const resto = u.slice(inicio + marca.length);
    const dosPuntos = resto.indexOf(':');
    const ruta = decodeURIComponent(resto.slice(0, dosPuntos));
    const sufijo = /^\/[a-z]+/.exec(resto.slice(dosPuntos + 1))?.[0];
    const metodo = (init?.method ?? 'GET').toUpperCase();
    llamadas.push({ metodo, ruta: `${ruta}${sufijo ?? ''}` });
    if (sufijo === '/children') {
      const hijos = new Map<string, boolean>();
      for (const k of archivos.keys()) {
        if (!k.startsWith(`${ruta}/`)) continue;
        const [primero, ...mas] = k.slice(ruta.length + 1).split('/');
        hijos.set(primero, hijos.get(primero) === true || mas.length > 0);
      }
      if (hijos.size === 0) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ value: [...hijos].map(([name, esCarpeta]) => ({ name, ...(esCarpeta ? { folder: {} } : {}) })) }), { status: 200 });
    }
    if (sufijo === '/content' && metodo === 'PUT') {
      if (u.includes('conflictBehavior=fail') && archivos.has(ruta)) return new Response('{}', { status: 409 });
      archivos.set(ruta, String(init?.body));
      return new Response('{}', { status: 201 });
    }
    if (sufijo === '/content') return archivos.has(ruta) ? new Response(archivos.get(ruta), { status: 200 }) : new Response('{}', { status: 404 });
    return new Response('{}', { status: 404 });
  });
  return {
    f: f as unknown as typeof fetch,
    archivos,
    llamadas,
    caer: (estado: number | null) => {
      caido = estado;
    },
  };
}

let sp: ReturnType<typeof sharePointFalso>;
const deps = (ahora: Date = T0) => ({ config: CFG, fetch: sp.f, ahora });
const guardar = (definicion: unknown, nuevo: boolean, ahora?: Date) => guardarDefinicionSst({ definicion, nuevo, correo: ADMIN }, deps(ahora));
const codigos = async () => (await listarFormulariosSst(deps())).map((x) => x.codigo);

beforeEach(() => {
  _reiniciarCacheToken();
  _reiniciarCacheCatalogoSst();
  sp = sharePointFalso();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('sin nada guardado', () => {
  it('los del código (B1 y B2) están siempre, sin editar, y la carpeta que no existe no es un error', async () => {
    const l = await listarFormulariosSst(deps());
    expect(l.map((x) => [x.codigo, x.origen, x.editado, x.guardadoEl])).toEqual([
      ['SST-REPORTE-ACTOS', 'base', false, null],
      ['SST-SALUD-OSTEOMUSCULAR', 'base', false, null],
    ]);
    expect(l[0].definicion).toEqual(REPORTE.definicion);
  });
  it('se busca por código; cualquier otra cosa no existe', async () => {
    expect((await formularioSstActual('SST-SALUD-OSTEOMUSCULAR', deps()))?.titulo).toBe(SALUD.titulo);
    for (const malo of ['', 'sst-salud-osteomuscular', '../x', null, undefined, 3, {}]) expect(await formularioSstActual(malo, deps()), String(malo)).toBeNull();
  });
});

describe('crear un formulario nuevo', () => {
  it('guarda UN archivo en FORMULARIOS SST/DEFINICIONES/<código>/<marca>.json con quién y cuándo, y aparece en la lista', async () => {
    const r = await guardar(def(), true);
    expect(r).toMatchObject({ codigo: 'SST-NUEVO', titulo: 'Reporte nuevo', origen: 'personalizado', editado: false, guardadoEl: T0.toISOString() });
    expect([...sp.archivos.keys()]).toEqual([RUTA('SST-NUEVO', '20261020100000')]);
    const a = JSON.parse([...sp.archivos.values()][0]);
    expect(a).toMatchObject({ v: 1, guardadoPor: 'cristian.baldion@gsslatam.com', guardadoEl: T0.toISOString() });
    expect(a.definicion.codigo).toBe('SST-NUEVO');
    expect(await codigos()).toEqual(['SST-REPORTE-ACTOS', 'SST-SALUD-OSTEOMUSCULAR', 'SST-NUEVO']);
  });
  it('los propios van después de B1 y B2, ordenados por título', async () => {
    await guardar(def('SST-ZZZ', { titulo: 'Zeta' }), true);
    await guardar(def('SST-AAA', { titulo: 'Alfa' }), true, new Date(T0.getTime() + 1000));
    expect(await codigos()).toEqual(['SST-REPORTE-ACTOS', 'SST-SALUD-OSTEOMUSCULAR', 'SST-AAA', 'SST-ZZZ']);
  });
  it('un código que ya existe (del código, guardado o retirado) se rechaza con 409', async () => {
    await expect(guardar(def('SST-REPORTE-ACTOS'), true)).rejects.toMatchObject({ estado: 409 });
    await guardar(def(), true);
    await expect(guardar(def(), true, new Date(T0.getTime() + 1000))).rejects.toMatchObject({ estado: 409 });
    await retirarFormularioSst({ codigo: 'SST-NUEVO', correo: ADMIN }, deps(new Date(T0.getTime() + 2000)));
    await expect(guardar(def(), true, new Date(T0.getTime() + 3000))).rejects.toMatchObject({ estado: 409 });
  });
  it('códigos peligrosos o reservados (carpetas de SharePoint) se rechazan con 422 y no se guarda nada', async () => {
    for (const codigo of ['../x', 'a b', 'ab', 'a/b', 'DEFINICIONES', 'definiciones', '-abc', 'x'.repeat(61)]) {
      await expect(guardar(def(codigo), true), codigo).rejects.toMatchObject({ estado: 422 });
    }
    expect(sp.archivos.size).toBe(0);
  });
  it('una evaluación no es un formulario SST (422); una definición inválida trae la lista de problemas (422)', async () => {
    const eva = await guardar({ ...def(), tipo: 'evaluacion', notaMinima: 70, preguntas: [{ id: 'q1', texto: 'A', tipo: 'seleccion', obligatoria: true, opciones: ['x', 'y'], puntos: 100, correcta: 0 }] }, true).catch((e) => e);
    expect(eva).toBeInstanceOf(ErrorCatalogoSst);
    expect(eva).toMatchObject({ estado: 422, errores: ['Los formularios SST son encuestas, no evaluaciones.'] });
    const mala = await guardar({ ...def(), preguntas: [] }, true).catch((e) => e);
    expect(mala).toMatchObject({ estado: 422, message: 'Revise el formulario.' });
    expect(mala.errores.length).toBeGreaterThan(0);
    expect(sp.archivos.size).toBe(0);
  });
  it('lo que no es un objeto o es demasiado grande: 400 y 413', async () => {
    for (const malo of [null, 'texto', 5, [], undefined]) await expect(guardar(malo, true), String(malo)).rejects.toMatchObject({ estado: 400 });
    await expect(guardar(def('SST-GRANDE', { descripcion: 'x'.repeat(250 * 1024) }), true)).rejects.toMatchObject({ estado: 413 });
    expect(sp.archivos.size).toBe(0);
  });
  it('hay un tope de formularios propios', async () => {
    for (let i = 0; i < MAX_FORMULARIOS_SST_PERSONALIZADOS; i++) {
      sp.archivos.set(RUTA(`SST-F${i}`, '20261020100000'), JSON.stringify({ v: 1, guardadoPor: 'a@x.com', guardadoEl: T0.toISOString(), definicion: def(`SST-F${i}`, { titulo: `F${i}` }) }));
    }
    await expect(guardar(def('SST-OTRO'), true)).rejects.toMatchObject({ estado: 422 });
    await guardar(def('SST-F0', { titulo: 'F0 editado' }), false, new Date(T0.getTime() + 1000)); // editar uno que existe sigue siendo posible
  });
  it('si dos guardados caen en el mismo segundo, el segundo avisa (409) y no pisa al primero', async () => {
    await guardar(def(), true);
    await expect(guardar(def('SST-NUEVO', { titulo: 'Otro título' }), false)).rejects.toMatchObject({ estado: 409 });
    expect(JSON.parse([...sp.archivos.values()][0]).definicion.titulo).toBe('Reporte nuevo');
  });
});

describe('editar: cada guardado es una versión nueva y nada se borra', () => {
  it('editar uno propio deja las dos versiones en SharePoint; la vigente es la más reciente', async () => {
    await guardar(def(), true);
    await guardar(def('SST-NUEVO', { titulo: 'Reporte corregido' }), false, new Date(T0.getTime() + 3600_000));
    expect([...sp.archivos.keys()].sort()).toEqual([RUTA('SST-NUEVO', '20261020100000'), RUTA('SST-NUEVO', '20261020110000')]);
    expect((await formularioSstActual('SST-NUEVO', deps()))?.titulo).toBe('Reporte corregido');
  });
  it('se pueden editar B1 y B2: la definición guardada los reemplaza, siguen en su lugar y quedan marcados como editados', async () => {
    const editada = { ...REPORTE.definicion, titulo: 'REPORTE DE ACTOS (versión corregida)' };
    const r = await guardar(editada, false);
    expect(r).toMatchObject({ codigo: 'SST-REPORTE-ACTOS', origen: 'base', editado: true });
    const l = await listarFormulariosSst(deps());
    expect(l.map((x) => x.codigo)).toEqual(['SST-REPORTE-ACTOS', 'SST-SALUD-OSTEOMUSCULAR']);
    expect(l[0]).toMatchObject({ titulo: 'REPORTE DE ACTOS (versión corregida)', origen: 'base', editado: true });
    expect(l[1]).toMatchObject({ editado: false });
    expect(l[1].definicion).toEqual(SALUD.definicion);
  });
  it('editar algo que no existe o fue retirado: 404', async () => {
    await expect(guardar(def('SST-FANTASMA'), false)).rejects.toMatchObject({ estado: 404 });
    await guardar(def(), true);
    await retirarFormularioSst({ codigo: 'SST-NUEVO', correo: ADMIN }, deps(new Date(T0.getTime() + 1000)));
    await expect(guardar(def(), false, new Date(T0.getTime() + 2000))).rejects.toMatchObject({ estado: 404 });
  });
  it('si la versión más reciente está dañada se usa la anterior; si lo que trae el archivo es de otro código, se ignora', async () => {
    await guardar(def(), true);
    sp.archivos.set(RUTA('SST-NUEVO', '20261020120000'), '{no es json');
    sp.archivos.set(RUTA('SST-NUEVO', '20261020130000'), JSON.stringify({ v: 1, guardadoEl: T0.toISOString(), definicion: def('SST-REPORTE-ACTOS', { titulo: 'SUPLANTADO' }) }));
    sp.archivos.set(RUTA('SST-OTRO', '20261020100000'), JSON.stringify({ v: 1, guardadoEl: T0.toISOString(), definicion: { formato: 1, codigo: 'SST-OTRO' } }));
    const l = await listarFormulariosSst(deps());
    expect(l.find((x) => x.codigo === 'SST-NUEVO')?.titulo).toBe('Reporte nuevo');
    expect(l.find((x) => x.codigo === 'SST-REPORTE-ACTOS')?.titulo).toBe(REPORTE.titulo); // nadie lo suplantó
    expect(l.some((x) => x.codigo === 'SST-OTRO')).toBe(false); // definición inválida: no aparece ni rompe la lista
  });
  it('ignora lo que no es un formulario: archivos sueltos, carpetas con nombre raro y versiones con otro formato', async () => {
    sp.archivos.set(`FORMULARIOS SST/${CARPETA_DEFINICIONES_SST}/notas.txt`, 'hola');
    sp.archivos.set(`FORMULARIOS SST/${CARPETA_DEFINICIONES_SST}/a b/20261020100000.json`, JSON.stringify({ v: 1, guardadoEl: 'x', definicion: def('a b') }));
    sp.archivos.set(RUTA('SST-RARO', 'notas'), 'x');
    expect(await codigos()).toEqual(['SST-REPORTE-ACTOS', 'SST-SALUD-OSTEOMUSCULAR']);
  });
});

describe('retirar', () => {
  it('deja de mostrarse, y las versiones se conservan; B1 y B2 no se pueden retirar', async () => {
    await guardar(def(), true);
    await retirarFormularioSst({ codigo: 'SST-NUEVO', correo: ADMIN }, deps(new Date(T0.getTime() + 1000)));
    expect(await codigos()).toEqual(['SST-REPORTE-ACTOS', 'SST-SALUD-OSTEOMUSCULAR']);
    expect(sp.archivos.size).toBe(2);
    const retiro = JSON.parse(sp.archivos.get(RUTA('SST-NUEVO', '20261020100001'))!);
    expect(retiro).toMatchObject({ v: 1, retirado: true, guardadoPor: 'cristian.baldion@gsslatam.com' });
    expect(retiro.definicion).toBeUndefined();
    for (const codigo of ['SST-REPORTE-ACTOS', 'SST-SALUD-OSTEOMUSCULAR']) {
      await expect(retirarFormularioSst({ codigo, correo: ADMIN }, deps()), codigo).rejects.toMatchObject({ estado: 400 });
    }
  });
  it('un retiro guardado sobre B1 o B2 no los oculta (los botones de la página principal dependen de ellos)', async () => {
    sp.archivos.set(RUTA('SST-REPORTE-ACTOS', '20261020100000'), JSON.stringify({ v: 1, guardadoEl: T0.toISOString(), retirado: true }));
    expect(await codigos()).toEqual(['SST-REPORTE-ACTOS', 'SST-SALUD-OSTEOMUSCULAR']);
  });
  it('código inválido 400; inexistente o ya retirado 404', async () => {
    for (const codigo of ['../x', '', null, undefined, 5]) await expect(retirarFormularioSst({ codigo, correo: ADMIN }, deps()), String(codigo)).rejects.toMatchObject({ estado: 400 });
    await expect(retirarFormularioSst({ codigo: 'SST-NO-EXISTE', correo: ADMIN }, deps())).rejects.toMatchObject({ estado: 404 });
    await guardar(def(), true);
    await retirarFormularioSst({ codigo: 'SST-NUEVO', correo: ADMIN }, deps(new Date(T0.getTime() + 1000)));
    await expect(retirarFormularioSst({ codigo: 'SST-NUEVO', correo: ADMIN }, deps(new Date(T0.getTime() + 2000)))).rejects.toMatchObject({ estado: 404 });
  });
});

describe('caché y SharePoint caído', () => {
  it('la lista se recuerda un minuto: no vuelve a leer SharePoint; guardar la invalida; pasado el minuto se vuelve a leer', async () => {
    await listarFormulariosSst(deps());
    const n = sp.llamadas.length;
    await listarFormulariosSst(deps());
    expect(sp.llamadas.length).toBe(n);
    await guardar(def(), true);
    expect(await codigos()).toContain('SST-NUEVO');
    const m = sp.llamadas.length;
    await listarFormulariosSst({ ...deps(), ahora: new Date(Date.now() + CATALOGO_CACHE_MS + 1000) });
    expect(sp.llamadas.length).toBeGreaterThan(m);
  });
  it('si SharePoint no responde, el catálogo no se cae: sigue con lo último conocido, o con B1 y B2 si no hay nada', async () => {
    sp.caer(500);
    expect(await codigos()).toEqual(['SST-REPORTE-ACTOS', 'SST-SALUD-OSTEOMUSCULAR']);
    sp.caer(null);
    await guardar(def(), true);
    await listarFormulariosSst(deps());
    sp.caer(500);
    // con el caché vencido y SharePoint caído, lo último que se leyó
    const lista = await listarFormulariosSst({ ...deps(), ahora: new Date(Date.now() + CATALOGO_CACHE_MS + 1000) });
    expect(lista.map((x) => x.codigo)).toContain('SST-NUEVO');
  });
  it('el aviso en el registro lleva solo el tipo de error, sin datos', async () => {
    sp.caer(403);
    await listarFormulariosSst(deps());
    const texto = JSON.stringify((console.error as ReturnType<typeof vi.fn>).mock.calls);
    expect(texto).toMatch(/SharePoint no disponible/);
    expect(texto).not.toMatch(/gsslatam|Reporte|1010/);
  });
  it('para ADMINISTRAR no se disfraza el fallo: si no se puede leer, lanza, y guardar tampoco parte de los del código', async () => {
    sp.caer(403);
    await expect(catalogoParaAdministrar(deps())).rejects.toBeInstanceOf(FormacionStorageError);
    await expect(guardar(REPORTE.definicion, false)).rejects.toMatchObject({ status: 403 });
    await expect(retirarFormularioSst({ codigo: 'SST-NUEVO', correo: ADMIN }, deps())).rejects.toBeInstanceOf(FormacionStorageError);
  });
  it('si SharePoint rechaza escribir, el error es de almacenamiento (nunca un éxito falso) y no se recuerda nada', async () => {
    const roto = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('https://login.microsoftonline.com/')) return new Response(JSON.stringify({ access_token: '***', expires_in: 3600 }), { status: 200 });
      return new Response('{}', { status: (init?.method ?? 'GET') === 'PUT' ? 403 : 404 });
    });
    await expect(guardarDefinicionSst({ definicion: def(), nuevo: true, correo: ADMIN }, { config: CFG, fetch: roto as unknown as typeof fetch, ahora: T0 })).rejects.toMatchObject({ status: 403 });
    expect(await codigos()).toEqual(['SST-REPORTE-ACTOS', 'SST-SALUD-OSTEOMUSCULAR']);
  });
});
