import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormacionStorageError, FormacionStorageNoConfigurado, _reiniciarCacheToken } from '../formacion-storage';
import type { PersonaConDia } from '../cumpleanos';
import { MAX_MENSAJES_POR_REMITENTE } from '../mensajes-cumple';
import {
  ADMINISTRADORES_MENSAJES_POR_DEFECTO,
  CARPETA_MENSAJES_POR_DEFECTO,
  ErrorMensaje,
  administradoresMensajes,
  borrarMensaje,
  claveDestinatario,
  claveRemitente,
  enviarMensaje,
  esAdministradorMensajes,
  esNombreArchivoMensaje,
  leerConfigMensajes,
  mensajesVisibles,
  nombreArchivoMensaje,
  type ConfigMensajes,
} from '../mensajes-cumple-servidor';

// Mensajes de cumpleaños (Cristian Baldión, 2026-10-20). SharePoint SIMULADO con un almacén en memoria; personas inventadas.

const HOY = '2026-10-19';
const ENV = {
  PORTAL_TH_SP_TENANT_ID: 't',
  PORTAL_TH_SP_CLIENT_ID: 'c',
  PORTAL_TH_SP_CLIENT_SECRET: '***',
  PORTAL_TH_SP_SITE_ID: 'gsslatam.sharepoint.com,1,2',
} as unknown as NodeJS.ProcessEnv;
const CFG: ConfigMensajes = { tenantId: 't', clientId: 'c', clientSecret: '***', siteId: 'gsslatam.sharepoint.com,1,2', carpeta: 'MENSAJES CUMPLEANOS' };

const ANA = { nombre: 'PEREZ GOMEZ ANA', empresa: 'GROUP SHARED SERVICES SAS', cargo: 'ANALISTA', correo: 'ana.perez@gsslatam.com', mes: 10, dia: 19 };
const LUIS = { nombre: 'RUIZ SOTO LUIS', empresa: 'LABORATORIO RYAN', cargo: 'AUXILIAR', correo: 'No Aplica', mes: 10, dia: 19 }; // sin correo
const JUAN = { nombre: 'MORA PINTO JUAN', empresa: 'ABAMIA LABS SAS', cargo: 'GERENTE', correo: 'juan.mora@gsslatam.com', mes: 10, dia: 19 };
const MARTA = { nombre: 'LOPEZ DIAZ MARTA', empresa: 'KELAB SAS', cargo: 'JEFE', correo: 'marta.lopez@gsslatam.com', mes: 10, dia: 25 };
const PERSONAS: PersonaConDia[] = [ANA, LUIS, JUAN, MARTA];
const ADMIN = 'cristian.baldion@gsslatam.com';

type Extra = Partial<{ config: ConfigMensajes; fetch: typeof fetch; personas: () => Promise<PersonaConDia[]>; hoy: string; ahora: Date; env: NodeJS.ProcessEnv }>;

/** Un SharePoint de mentira: guarda, lista, lee y borra archivos por ruta. */
function sharePointFalso() {
  const archivos = new Map<string, string>();
  const llamadas: { metodo: string; ruta: string }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('https://login.microsoftonline.com/')) return new Response(JSON.stringify({ access_token: 'x', expires_in: 3600 }), { status: 200 });
    const marca = 'drive/root:/';
    const inicio = u.indexOf(marca);
    if (inicio < 0) return new Response('{}', { status: 404 });
    const resto = u.slice(inicio + marca.length);
    const dosPuntos = resto.indexOf(':');
    if (dosPuntos < 0) return new Response('{}', { status: 404 });
    const ruta = decodeURIComponent(resto.slice(0, dosPuntos));
    const sufijo = /^\/[a-z]+/.exec(resto.slice(dosPuntos + 1))?.[0];
    const m = [null, ruta, sufijo];
    const metodo = (init?.method ?? 'GET').toUpperCase();
    llamadas.push({ metodo, ruta: `${ruta}${m[2] ?? ''}` });
    if (m[2] === '/children') {
      const hijos = [...archivos.keys()].filter((k) => k.startsWith(`${ruta}/`)).map((k) => ({ name: k.slice(ruta.length + 1) }));
      return hijos.length === 0 ? new Response('{}', { status: 404 }) : new Response(JSON.stringify({ value: hijos }), { status: 200 });
    }
    if (m[2] === '/content' && metodo === 'PUT') {
      if (u.includes('conflictBehavior=fail') && archivos.has(ruta)) return new Response('{}', { status: 409 });
      archivos.set(ruta, String(init?.body));
      return new Response('{}', { status: 201 });
    }
    if (m[2] === '/content') return archivos.has(ruta) ? new Response(archivos.get(ruta), { status: 200 }) : new Response('{}', { status: 404 });
    if (metodo === 'DELETE') return archivos.delete(ruta) ? new Response(null, { status: 204 }) : new Response('{}', { status: 404 });
    return new Response('{}', { status: 404 });
  });
  return { f: f as unknown as typeof fetch, archivos, llamadas };
}

let sp: ReturnType<typeof sharePointFalso>;
let reloj = 0;
const deps = (extra: Extra = {}) => ({
  config: CFG,
  fetch: sp.f,
  personas: async () => PERSONAS,
  hoy: HOY,
  ahora: new Date(Date.UTC(2026, 9, 19, 15, 0, reloj++)),
  env: {} as NodeJS.ProcessEnv,
  ...extra,
});
const enviar = (desde: string, para: { nombre: string; empresa: string }, texto = '¡Feliz cumpleaños! 🎉', extra: Extra = {}) =>
  enviarMensaje({ correo: desde, nombreRemitente: 'Carlos Ruiz', fecha: HOY, nombre: para.nombre, empresa: para.empresa, texto }, deps(extra));

beforeEach(() => {
  _reiniciarCacheToken();
  sp = sharePointFalso();
  reloj = 0;
});

describe('configuración y administrador', () => {
  it('por defecto la carpeta es «MENSAJES CUMPLEANOS» y el administrador es Cristian', () => {
    expect(CARPETA_MENSAJES_POR_DEFECTO).toBe('MENSAJES CUMPLEANOS');
    expect(leerConfigMensajes(ENV).carpeta).toBe('MENSAJES CUMPLEANOS');
    expect(ADMINISTRADORES_MENSAJES_POR_DEFECTO).toEqual([ADMIN]);
    expect(administradoresMensajes({} as NodeJS.ProcessEnv)).toEqual([ADMIN]);
  });
  it('las variables cambian la carpeta y el administrador; lo peligroso y lo que no es correo se rechaza', () => {
    expect(leerConfigMensajes({ ...ENV, PORTAL_TH_SP_MENSAJES_CUMPLE: 'OTRA CARPETA' } as NodeJS.ProcessEnv).carpeta).toBe('OTRA CARPETA');
    for (const mala of ['..', 'A/B', 'A:B', '/A']) {
      expect(() => leerConfigMensajes({ ...ENV, PORTAL_TH_SP_MENSAJES_CUMPLE: mala } as NodeJS.ProcessEnv), mala).toThrow(FormacionStorageNoConfigurado);
    }
    expect(() => leerConfigMensajes({} as NodeJS.ProcessEnv)).toThrow(FormacionStorageNoConfigurado);
    const env = { PORTAL_TH_MENSAJES_ADMINISTRADORES: ' A@x.com, a@x.com, sin-arroba, b@x.com ' } as unknown as NodeJS.ProcessEnv;
    expect(administradoresMensajes(env)).toEqual(['a@x.com', 'b@x.com']);
    expect(esAdministradorMensajes('B@X.com', env)).toBe(true);
    for (const no of ['otra@x.com', '', null, undefined, 5]) expect(esAdministradorMensajes(no, env), String(no)).toBe(false);
  });
});

describe('huellas y nombres de archivo (sin datos personales)', () => {
  it('la huella del destinatario es estable, ignora mayúsculas del correo y no contiene datos personales', () => {
    const a = claveDestinatario({ correo: 'Ana.Perez@gsslatam.com', nombre: 'X', empresa: 'Y' });
    expect(a).toBe(claveDestinatario({ correo: 'ana.perez@gsslatam.com', nombre: 'otro', empresa: 'otra' }));
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(claveDestinatario({ correo: null, nombre: 'Luis Ruiz', empresa: 'Ryan' })).toBe(claveDestinatario({ correo: null, nombre: 'LUIS  RUIZ', empresa: 'RYAN' }));
    expect(claveDestinatario({ correo: null, nombre: 'Luis Ruiz', empresa: 'Ryan' })).not.toBe(claveDestinatario({ correo: null, nombre: 'Luis Ruiz', empresa: 'Abamia' }));
    expect(claveRemitente('Carlos@x.com')).toBe(claveRemitente('carlos@x.com'));
  });
  it('el nombre de archivo tiene un formato fijo y no deja pasar rutas raras', () => {
    const n = nombreArchivoMensaje('a'.repeat(12), 'b'.repeat(8), new Date(Date.UTC(2026, 9, 19, 15, 30, 5)), 'abc123');
    expect(n).toBe('aaaaaaaaaaaa-bbbbbbbb-20261019153005-abc123.json');
    expect(esNombreArchivoMensaje(n)).toBe(true);
    for (const mal of ['../x.json', 'a/b.json', 'aaaaaaaaaaaa-bbbbbbbb-20261019153005-abc123.txt', 'x', '', null, undefined, 7, 'aaaaaaaaaaaa-bbbbbbbb-20261019153005-abc123.json/..']) {
      expect(esNombreArchivoMensaje(mal), String(mal)).toBe(false);
    }
  });
});

describe('enviarMensaje', () => {
  it('guarda UN archivo en MENSAJES CUMPLEANOS/<fecha>/ con el texto, y el nombre del archivo no trae datos personales', async () => {
    await enviar('carlos@gsslatam.com', ANA);
    expect(sp.archivos.size).toBe(1);
    const [ruta, contenido] = [...sp.archivos.entries()][0];
    expect(ruta).toMatch(/^MENSAJES CUMPLEANOS\/2026-10-19\/[0-9a-f]{12}-[0-9a-f]{8}-[0-9]{14}-[0-9a-f]{6}\.json$/);
    expect(ruta.slice('MENSAJES CUMPLEANOS/2026-10-19/'.length)).not.toMatch(/ana|perez|carlos|gsslatam/i);
    const m = JSON.parse(contenido);
    expect(m).toMatchObject({ v: 1, fecha: HOY, texto: '¡Feliz cumpleaños! 🎉', para: { nombre: ANA.nombre, empresa: ANA.empresa, correo: 'ana.perez@gsslatam.com' }, de: { nombre: 'Carlos Ruiz', correo: 'carlos@gsslatam.com' } });
  });
  it('la persona sale de BASE PERSONAL, no de lo que escriba el navegador: mayúsculas y tildes no importan; otra persona, sí', async () => {
    await enviar('carlos@gsslatam.com', { nombre: 'pérez gómez ana', empresa: 'group shared services sas' });
    expect(sp.archivos.size).toBe(1);
    await expect(enviar('carlos@gsslatam.com', { nombre: 'MARTA LOPEZ', empresa: 'KELAB SAS' })).rejects.toMatchObject({ estado: 404 });
    await expect(enviar('carlos@gsslatam.com', { nombre: ANA.nombre, empresa: 'OTRA EMPRESA' })).rejects.toMatchObject({ estado: 404 });
    // Marta cumple el 25, no hoy: tampoco se le escribe aunque exista
    await expect(enviar('carlos@gsslatam.com', MARTA)).rejects.toMatchObject({ estado: 404 });
  });
  it('un día fuera de la ventana (futuro o de hace más de 7 días) o una fecha inválida se rechaza', async () => {
    for (const fecha of ['2026-10-20', '2026-10-11', '2025-10-19', 'basura', '', null, 20261019, '2026-02-30']) {
      await expect(enviarMensaje({ correo: 'c@x.com', nombreRemitente: 'C', fecha, nombre: ANA.nombre, empresa: ANA.empresa, texto: 'hola' }, deps()), String(fecha)).rejects.toMatchObject({ estado: 400 });
    }
    expect(sp.archivos.size).toBe(0);
  });
  it('texto vacío o de más de 500 caracteres: se rechaza con su mensaje y no se guarda nada', async () => {
    await expect(enviar('c@x.com', ANA, '   ')).rejects.toMatchObject({ estado: 400, message: 'Escriba su mensaje.' });
    await expect(enviar('c@x.com', ANA, 'a'.repeat(501))).rejects.toMatchObject({ estado: 400, message: 'El mensaje admite máximo 500 caracteres.' });
    expect(sp.archivos.size).toBe(0);
  });
  it('máximo 3 mensajes por remitente a la misma persona el mismo día; otro remitente y otra persona sí pueden', async () => {
    for (let i = 0; i < MAX_MENSAJES_POR_REMITENTE; i++) await enviar('carlos@gsslatam.com', ANA, `mensaje ${i}`);
    await expect(enviar('carlos@gsslatam.com', ANA, 'otro más')).rejects.toMatchObject({ estado: 429 });
    await enviar('otra@gsslatam.com', ANA, 'de otra persona');
    await enviar('carlos@gsslatam.com', JUAN, 'a otra persona');
    expect(sp.archivos.size).toBe(MAX_MENSAJES_POR_REMITENTE + 2);
  });
  it('a quien no tiene correo corporativo («No Aplica») se le puede escribir: el mensaje se guarda sin correo de destino', async () => {
    await enviar('carlos@gsslatam.com', LUIS);
    const m = JSON.parse([...sp.archivos.values()][0]);
    expect(m.para.correo).toBeNull();
    expect(m.para.nombre).toBe(LUIS.nombre);
  });
  it('dos personas con el mismo nombre y empresa: no se sabe cuál es, así que el destino queda sin correo (solo el administrador lo ve)', async () => {
    const gemelo = { ...ANA, correo: 'otra.ana@gsslatam.com' };
    await enviarMensaje({ correo: 'c@x.com', nombreRemitente: 'C', fecha: HOY, nombre: ANA.nombre, empresa: ANA.empresa, texto: 'hola' }, deps({ personas: async () => [ANA, gemelo] }));
    expect(JSON.parse([...sp.archivos.values()][0]).para.correo).toBeNull();
  });
  it('si SharePoint rechaza guardar, el error es de almacenamiento (no se disfraza de éxito)', async () => {
    const roto = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith('https://login.microsoftonline.com/')) return new Response(JSON.stringify({ access_token: 'x', expires_in: 3600 }), { status: 200 });
      return new Response('{}', { status: u.includes('/children') ? 404 : 403 });
    });
    await expect(enviar('c@x.com', ANA, 'hola', { fetch: roto as unknown as typeof fetch })).rejects.toMatchObject({ status: 403 });
    await expect(enviar('c@x.com', ANA, 'hola', { fetch: roto as unknown as typeof fetch })).rejects.toBeInstanceOf(FormacionStorageError);
  });
});

describe('mensajesVisibles: QUIÉN lee qué', () => {
  beforeEach(async () => {
    await enviar('carlos@gsslatam.com', ANA, 'Para Ana, de Carlos');
    await enviar('sofia@gsslatam.com', ANA, 'Para Ana, de Sofía');
    await enviar('carlos@gsslatam.com', JUAN, 'Para Juan, de Carlos');
    await enviar('carlos@gsslatam.com', LUIS, 'Para Luis (sin correo), de Carlos');
  });
  const ver = (correo: string, fecha: string = HOY, extra: Extra = {}) => mensajesVisibles({ correo, fecha }, deps(extra));

  it('la cumpleañera ve SOLO los suyos, con el nombre de quien los escribió y sin su correo', async () => {
    const r = await ver('ana.perez@gsslatam.com');
    expect(r.puedeModerar).toBe(false);
    expect(r.mensajes.map((m) => m.texto).sort()).toEqual(['Para Ana, de Carlos', 'Para Ana, de Sofía']);
    expect(r.mensajes[0].deNombre).toBe('Carlos Ruiz');
    const texto = JSON.stringify(r);
    expect(texto).not.toMatch(/carlos@|sofia@|deCorreo|sinCorreo|Para Juan|Para Luis/);
  });
  it('ignora mayúsculas del correo de la sesión', async () => {
    expect((await ver('ANA.Perez@GSSLATAM.com')).mensajes).toHaveLength(2);
  });
  it('otro cumpleañero ve lo suyo y NUNCA lo de Ana', async () => {
    const r = await ver('juan.mora@gsslatam.com');
    expect(r.mensajes.map((m) => m.texto)).toEqual(['Para Juan, de Carlos']);
  });
  it('quien los escribió NO los puede leer después, ni nadie más que no cumpla años ese día', async () => {
    for (const correo of ['carlos@gsslatam.com', 'sofia@gsslatam.com', 'cualquiera@gsslatam.com', 'marta.lopez@gsslatam.com', 'nicolas.rivera@gsslatam.com']) {
      const r = await ver(correo);
      expect(r, correo).toEqual({ mensajes: [], puedeModerar: false });
    }
  });
  it('para quien no es cumpleañero no se toca SharePoint en absoluto (ni lista ni lee)', async () => {
    sp.llamadas.length = 0;
    await ver('cualquiera@gsslatam.com');
    expect(sp.llamadas).toEqual([]);
  });
  it('el administrador ve TODOS, con el correo de quien escribió y marcados los de quien no tiene correo, y puede moderar', async () => {
    const r = await ver(ADMIN);
    expect(r.puedeModerar).toBe(true);
    expect(r.mensajes).toHaveLength(4);
    const luis = r.mensajes.find((m) => m.paraNombre === LUIS.nombre)!;
    expect(luis.sinCorreo).toBe(true);
    expect(luis.deCorreo).toBe('carlos@gsslatam.com');
    expect(r.mensajes.find((m) => m.paraNombre === ANA.nombre)!.sinCorreo).toBe(false);
    expect(r.mensajes.every((m) => esNombreArchivoMensaje(m.id))).toBe(true);
  });
  it('quien no tiene correo no puede leer lo suyo (no tiene cómo entrar): solo el administrador', async () => {
    expect((await ver('no aplica')).mensajes).toEqual([]);
    expect((await ver('')).mensajes).toEqual([]);
  });
  it('pasada la ventana (8 días) el cumpleañero ya no los ve, pero el administrador sí', async () => {
    expect((await ver('ana.perez@gsslatam.com', HOY, { hoy: '2026-10-27' })).mensajes).toEqual([]);
    expect((await ver(ADMIN, HOY, { hoy: '2026-10-27' })).mensajes).toHaveLength(4);
    expect((await ver('ana.perez@gsslatam.com', HOY, { hoy: '2026-10-26' })).mensajes).toHaveLength(2); // 7 días: todavía
  });
  it('un archivo que dice ser de otra persona no se le entrega a la cumpleañera, aunque el nombre del archivo coincida', async () => {
    // Se fabrica un archivo con la huella de Ana pero cuyo contenido es para Juan.
    const claveAna = claveDestinatario({ correo: ANA.correo, nombre: ANA.nombre, empresa: ANA.empresa });
    const falso = `MENSAJES CUMPLEANOS/${HOY}/${claveAna}-${claveRemitente('x@x.com')}-20261019160000-aaaaaa.json`;
    sp.archivos.set(falso, JSON.stringify({ v: 1, fecha: HOY, para: { nombre: JUAN.nombre, empresa: JUAN.empresa, correo: JUAN.correo }, de: { nombre: 'X', correo: 'x@x.com' }, texto: 'esto es de Juan', enviadoEl: '2026-10-19T16:00:00Z' }));
    const r = await ver('ana.perez@gsslatam.com');
    expect(r.mensajes.map((m) => m.texto)).not.toContain('esto es de Juan');
  });
  it('ignora archivos que no son mensajes (otro nombre, JSON roto o sin la forma esperada)', async () => {
    sp.archivos.set(`MENSAJES CUMPLEANOS/${HOY}/notas.txt`, 'hola');
    sp.archivos.set(`MENSAJES CUMPLEANOS/${HOY}/${'a'.repeat(12)}-${'b'.repeat(8)}-20261019160000-aaaaaa.json`, '{no es json');
    sp.archivos.set(`MENSAJES CUMPLEANOS/${HOY}/${'a'.repeat(12)}-${'b'.repeat(8)}-20261019160001-bbbbbb.json`, JSON.stringify({ v: 2 }));
    expect((await ver(ADMIN)).mensajes).toHaveLength(4);
  });
  it('un día sin mensajes es una lista vacía, no un error; una fecha inválida sí es error', async () => {
    expect((await ver(ADMIN, '2026-10-18')).mensajes).toEqual([]);
    await expect(ver(ADMIN, 'x')).rejects.toMatchObject({ estado: 400 });
  });
});

describe('borrarMensaje', () => {
  it('el administrador borra; la persona que cumple años y cualquier otra NO pueden', async () => {
    await enviar('carlos@gsslatam.com', ANA);
    const id = (await mensajesVisibles({ correo: ADMIN, fecha: HOY }, deps())).mensajes[0].id;
    for (const correo of ['ana.perez@gsslatam.com', 'carlos@gsslatam.com', 'otra@x.com']) {
      await expect(borrarMensaje({ correo, fecha: HOY, id }, deps()), correo).rejects.toMatchObject({ estado: 403 });
    }
    expect(sp.archivos.size).toBe(1);
    await borrarMensaje({ correo: ADMIN, fecha: HOY, id }, deps());
    expect(sp.archivos.size).toBe(0);
    expect((await mensajesVisibles({ correo: 'ana.perez@gsslatam.com', fecha: HOY }, deps())).mensajes).toEqual([]);
  });
  it('rechaza ids con rutas, fechas inválidas, y avisa si el mensaje ya no existe', async () => {
    const idValido = nombreArchivoMensaje('a'.repeat(12), 'b'.repeat(8), new Date(), 'abcdef');
    for (const id of ['../../x', 'a/b.json', '', null, 'x.json']) {
      await expect(borrarMensaje({ correo: ADMIN, fecha: HOY, id }, deps()), String(id)).rejects.toMatchObject({ estado: 400 });
    }
    await expect(borrarMensaje({ correo: ADMIN, fecha: 'x', id: idValido }, deps())).rejects.toMatchObject({ estado: 400 });
    await expect(borrarMensaje({ correo: ADMIN, fecha: HOY, id: idValido }, deps())).rejects.toMatchObject({ estado: 404 });
  });
  it('solo toca la carpeta de mensajes: la ruta que se borra está dentro de MENSAJES CUMPLEANOS/<fecha>', async () => {
    await enviar('carlos@gsslatam.com', ANA);
    const id = (await mensajesVisibles({ correo: ADMIN, fecha: HOY }, deps())).mensajes[0].id;
    sp.llamadas.length = 0;
    await borrarMensaje({ correo: ADMIN, fecha: HOY, id }, deps());
    expect(sp.llamadas).toEqual([{ metodo: 'DELETE', ruta: `MENSAJES CUMPLEANOS/${HOY}/${id}` }]);
  });
});

describe('ErrorMensaje', () => {
  it('lleva el código HTTP y el mensaje que se le muestra a la persona', () => {
    const e = new ErrorMensaje(429, 'demasiados');
    expect(e.estado).toBe(429);
    expect(e.message).toBe('demasiados');
    expect(e).toBeInstanceOf(Error);
  });
});
