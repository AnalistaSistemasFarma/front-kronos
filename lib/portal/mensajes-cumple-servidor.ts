/**
 * PORTAL TH — MENSAJES DE CUMPLEAÑOS — guardado en SharePoint y permisos (Cristian Baldión, 2026-10-20).
 *
 * Cada mensaje es un archivo JSON en `MENSAJES CUMPLEANOS/<AAAA-MM-DD del cumpleaños>/` del sitio de Talento Humano (sin tabla ni SQL),
 * escrito con la misma app de Entra de Formación (`PORTAL_TH_SP_*`). La carpeta se puede cambiar con `PORTAL_TH_SP_MENSAJES_CUMPLE`.
 *
 * QUIÉN LEE UN MENSAJE (lo decide SIEMPRE el servidor, con el correo de la sesión; el navegador no manda ni recibe correos ajenos):
 *   - la persona que cumple años: cuando el correo de su sesión es el «Correo corporativo» que BASE PERSONAL le asigna, el día del
 *     cumpleaños y los 7 siguientes;
 *   - el administrador (`PORTAL_TH_MENSAJES_ADMINISTRADORES`, por defecto Cristian): todos, siempre, y puede borrarlos.
 *   Nadie más: ni quien lo escribió después de enviarlo.
 *
 * Si el cumpleañero NO tiene correo corporativo (en BASE PERSONAL suele decir «No Aplica»), igual se le puede escribir: el mensaje lo
 * ve solo el administrador, marcado «sin correo», para que lo haga llegar por otro medio.
 *
 * El nombre y la empresa del destinatario salen de BASE PERSONAL (no de lo que mande el navegador). Los nombres de archivo llevan solo
 * huellas (hash) del destinatario y del remitente, nunca datos personales.
 */
import { createHash, randomBytes } from 'node:crypto';
import { hoyEnBogota } from './calendario';
import { cumpleanerosDeLaFecha, leerPersonasConCumple, type PersonaConDia } from './cumpleanos';
import { FormacionStorageError, FormacionStorageNoConfigurado, esSegmentoValido, obtenerToken } from './formacion-storage';
import {
  MAX_MENSAJES_POR_DIA,
  MAX_MENSAJES_POR_REMITENTE,
  esCorreoMensaje,
  fechaEnVentanaMensaje,
  fechaIsoValida,
  validarTextoMensaje,
  type MensajeVisible,
  type RespuestaMensajes,
} from './mensajes-cumple';
import { leerConfigPoliticas, type ConfigPoliticas } from './politicas-storage';

export const CARPETA_MENSAJES_POR_DEFECTO = 'MENSAJES CUMPLEANOS';
export const ADMINISTRADORES_MENSAJES_POR_DEFECTO = ['cristian.baldion@gsslatam.com'] as const;
const GRAPH = 'https://graph.microsoft.com/v1.0';
type Fetch = typeof fetch;

export interface ConfigMensajes extends Omit<ConfigPoliticas, 'carpeta'> {
  carpeta: string;
}

export function leerConfigMensajes(env: NodeJS.ProcessEnv = process.env): ConfigMensajes {
  const base = leerConfigPoliticas({ ...env, PORTAL_TH_SP_POLICIES_FOLDER: undefined } as NodeJS.ProcessEnv);
  const carpeta = (env.PORTAL_TH_SP_MENSAJES_CUMPLE ?? '').trim() || CARPETA_MENSAJES_POR_DEFECTO;
  if (!esSegmentoValido(carpeta)) throw new FormacionStorageNoConfigurado('PORTAL_TH_SP_MENSAJES_CUMPLE no es un nombre de carpeta válido.');
  return { ...base, carpeta };
}

/** Quién administra (lee todo y borra). Se cambia con `PORTAL_TH_MENSAJES_ADMINISTRADORES` (correos separados por coma). */
export function administradoresMensajes(env: NodeJS.ProcessEnv = process.env): string[] {
  const crudo = (env.PORTAL_TH_MENSAJES_ADMINISTRADORES ?? '').trim();
  const lista = crudo ? crudo.split(',').map((c) => c.trim().toLowerCase()) : [...ADMINISTRADORES_MENSAJES_POR_DEFECTO];
  return [...new Set(lista.filter((c) => esCorreoMensaje(c)))];
}

export function esAdministradorMensajes(correo: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof correo === 'string' && administradoresMensajes(env).includes(correo.trim().toLowerCase());
}

/** Error con el mensaje que se le muestra a la persona y el código HTTP. */
export class ErrorMensaje extends Error {
  constructor(
    public readonly estado: number,
    mensaje: string
  ) {
    super(mensaje);
    this.name = 'ErrorMensaje';
  }
}

/* ───────────── Huellas y nombres de archivo ───────────── */

const sinTildes = (t: string) => t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const normalizar = (t: unknown) => sinTildes(String(t ?? '')).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const huella = (texto: string, largo: number) => createHash('sha256').update(texto).digest('hex').slice(0, largo);

/** Huella (12) del destinatario: por su correo si lo tiene; si no, por su nombre y empresa. */
export function claveDestinatario(p: { correo: string | null; nombre: string; empresa: string }): string {
  return huella(p.correo && esCorreoMensaje(p.correo) ? `c:${p.correo.trim().toLowerCase()}` : `n:${normalizar(p.nombre)}|${normalizar(p.empresa)}`, 12);
}
/** Huella (8) de quien escribe. */
export const claveRemitente = (correo: string) => huella(`r:${correo.trim().toLowerCase()}`, 8);

const ARCHIVO = /^[0-9a-f]{12}-[0-9a-f]{8}-[0-9]{14}-[0-9a-f]{6}\.json$/;
export const esNombreArchivoMensaje = (n: unknown): n is string => typeof n === 'string' && ARCHIVO.test(n);

export function nombreArchivoMensaje(dest: string, rem: string, ahora: Date, azar: string = randomBytes(3).toString('hex')): string {
  const marca = ahora.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${dest}-${rem}-${marca}-${azar}.json`;
}

/** Lo que se guarda en cada archivo. */
interface MensajeGuardado {
  v: 1;
  fecha: string;
  para: { nombre: string; empresa: string; correo: string | null };
  de: { nombre: string; correo: string };
  texto: string;
  enviadoEl: string;
}

/* ───────────── Graph ───────────── */

interface Ctx {
  cfg: ConfigMensajes;
  f: Fetch;
  cab: { Authorization: string };
  base: string;
}
async function contexto(deps: { config?: ConfigMensajes; fetch?: Fetch }): Promise<Ctx> {
  const cfg = deps.config ?? leerConfigMensajes();
  const f = deps.fetch ?? fetch;
  const token = await obtenerToken(cfg as unknown as Parameters<typeof obtenerToken>[0], f);
  return {
    cfg,
    f,
    cab: { Authorization: ['Bearer', token].join(' ') },
    base: `${GRAPH}/sites/${encodeURIComponent(cfg.siteId)}/drive/root:/${encodeURIComponent(cfg.carpeta)}`,
  };
}

async function listarNombres(c: Ctx, fecha: string): Promise<string[]> {
  const res = await c.f(`${c.base}/${fecha}:/children?$select=name&$top=200`, { headers: c.cab });
  if (res.status === 404) return []; // todavía nadie escribió ese día
  if (!res.ok) throw new FormacionStorageError(`Graph no listó los mensajes (${res.status}).`, res.status);
  const datos = (await res.json().catch(() => null)) as { value?: { name?: string }[] } | null;
  return (datos?.value ?? []).map((x) => x.name).filter(esNombreArchivoMensaje).sort();
}

async function leerArchivo(c: Ctx, fecha: string, nombre: string): Promise<MensajeGuardado | null> {
  const res = await c.f(`${c.base}/${fecha}/${encodeURIComponent(nombre)}:/content`, { headers: c.cab });
  if (!res.ok) return null;
  const m = (await res.json().catch(() => null)) as Partial<MensajeGuardado> | null;
  if (!m || m.v !== 1 || typeof m.texto !== 'string' || !m.para || !m.de) return null;
  return m as MensajeGuardado;
}

/* ───────────── Operaciones ───────────── */

interface DepsServicio {
  config?: ConfigMensajes;
  fetch?: Fetch;
  /** Para pruebas. */
  personas?: () => Promise<PersonaConDia[]>;
  hoy?: string;
  ahora?: Date;
  env?: NodeJS.ProcessEnv;
}
const personasDe = (d: DepsServicio) => (d.personas ?? (() => leerPersonasConCumple()))();

export interface EnvioMensaje {
  /** Correo de la sesión de quien escribe. */
  correo: string;
  /** Nombre a mostrar de quien escribe. */
  nombreRemitente: string;
  fecha: unknown;
  nombre: unknown;
  empresa: unknown;
  texto: unknown;
}

/** Guarda un mensaje. Lanza `ErrorMensaje` con lo que se le dice a la persona. */
export async function enviarMensaje(p: EnvioMensaje, deps: DepsServicio = {}): Promise<void> {
  const hoy = deps.hoy ?? hoyEnBogota();
  if (!fechaIsoValida(p.fecha)) throw new ErrorMensaje(400, 'La fecha no es válida.');
  if (!fechaEnVentanaMensaje(p.fecha, hoy)) throw new ErrorMensaje(400, 'Solo se puede dejar un mensaje el día del cumpleaños y en los 7 días siguientes.');
  const texto = validarTextoMensaje(p.texto);
  if (!texto.ok) throw new ErrorMensaje(400, texto.error);
  if (typeof p.nombre !== 'string' || typeof p.empresa !== 'string' || !p.nombre.trim()) throw new ErrorMensaje(400, 'Falta la persona a la que va el mensaje.');

  // El destinatario sale de BASE PERSONAL, no de lo que diga el navegador: solo se le escribe a quien de verdad cumple ese día.
  const candidatos = cumpleanerosDeLaFecha(await personasDe(deps), p.fecha).filter(
    (x) => normalizar(x.nombre) === normalizar(p.nombre) && normalizar(x.empresa) === normalizar(p.empresa)
  );
  if (candidatos.length === 0) throw new ErrorMensaje(404, 'Esa persona no cumple años ese día.');
  // Dos personas con el mismo nombre y empresa: no se sabe cuál es, así que el mensaje lo ve solo el administrador.
  const unica = candidatos.length === 1 ? candidatos[0] : null;
  const correoDest = unica && esCorreoMensaje(unica.correo) ? unica.correo.trim().toLowerCase() : null;
  const destino = { nombre: candidatos[0].nombre, empresa: candidatos[0].empresa, correo: correoDest };

  const c = await contexto(deps);
  const dest = claveDestinatario(destino);
  const rem = claveRemitente(p.correo);
  const existentes = await listarNombres(c, p.fecha);
  if (existentes.filter((n) => n.startsWith(`${dest}-${rem}-`)).length >= MAX_MENSAJES_POR_REMITENTE) {
    throw new ErrorMensaje(429, `Ya dejó ${MAX_MENSAJES_POR_REMITENTE} mensajes a esta persona hoy. Gracias por su cariño.`);
  }
  if (existentes.length >= MAX_MENSAJES_POR_DIA * 2) throw new ErrorMensaje(429, 'Hoy se dejaron demasiados mensajes. Intente mañana.');

  const ahora = deps.ahora ?? new Date();
  const registro: MensajeGuardado = {
    v: 1,
    fecha: p.fecha,
    para: destino,
    de: { nombre: p.nombreRemitente.trim().slice(0, 120) || 'Un compañero', correo: p.correo.trim().toLowerCase() },
    texto: texto.texto,
    enviadoEl: ahora.toISOString(),
  };
  const nombreArchivo = nombreArchivoMensaje(dest, rem, ahora);
  const res = await c.f(`${c.base}/${p.fecha}/${encodeURIComponent(nombreArchivo)}:/content?@microsoft.graph.conflictBehavior=fail`, {
    method: 'PUT',
    headers: { ...c.cab, 'Content-Type': 'application/json' },
    body: JSON.stringify(registro),
  });
  if (!res.ok) throw new FormacionStorageError(`Graph rechazó guardar el mensaje (${res.status}).`, res.status);
}

/** Los mensajes de un día que `correo` puede ver. Para quien no es ni el cumpleañero ni el administrador, siempre una lista vacía. */
export async function mensajesVisibles(p: { correo: string; fecha: unknown }, deps: DepsServicio = {}): Promise<RespuestaMensajes> {
  const hoy = deps.hoy ?? hoyEnBogota();
  if (!fechaIsoValida(p.fecha)) throw new ErrorMensaje(400, 'La fecha no es válida.');
  const fecha: string = p.fecha;
  const admin = esAdministradorMensajes(p.correo, deps.env);
  const yo = p.correo.trim().toLowerCase();

  let prefijos: string[] | null = null; // null = todos (administrador)
  if (!admin) {
    if (!fechaEnVentanaMensaje(fecha, hoy)) return { mensajes: [], puedeModerar: false };
    const mios = cumpleanerosDeLaFecha(await personasDe(deps), fecha).filter((x) => esCorreoMensaje(x.correo) && x.correo.trim().toLowerCase() === yo);
    if (mios.length === 0) return { mensajes: [], puedeModerar: false };
    prefijos = [...new Set(mios.map((x) => claveDestinatario({ correo: x.correo, nombre: x.nombre, empresa: x.empresa })))].map((k) => `${k}-`);
  }

  const c = await contexto(deps);
  const nombres = (await listarNombres(c, fecha)).filter((n) => prefijos === null || prefijos.some((x) => n.startsWith(x))).slice(-MAX_MENSAJES_POR_DIA);
  const leidos = await Promise.all(nombres.map(async (n) => ({ n, m: await leerArchivo(c, fecha, n) })));
  const mensajes: MensajeVisible[] = leidos
    .flatMap(({ n, m }) => (m ? [{ n, m }] : []))
    // El archivo dice para quién es: aunque el nombre coincidiera por casualidad, el cumpleañero solo lee lo suyo.
    .filter(({ m }) => admin || (m.para.correo !== null && m.para.correo.toLowerCase() === yo))
    .map(({ n, m }) => ({
      id: n,
      paraNombre: m.para.nombre,
      paraEmpresa: m.para.empresa,
      deNombre: m.de.nombre,
      texto: m.texto,
      enviadoEl: m.enviadoEl,
      ...(admin ? { deCorreo: m.de.correo, sinCorreo: m.para.correo === null } : {}),
    }))
    .sort((a, b) => a.enviadoEl.localeCompare(b.enviadoEl));
  return { mensajes, puedeModerar: admin };
}

/** Borra un mensaje. Solo el administrador. */
export async function borrarMensaje(p: { correo: string; fecha: unknown; id: unknown }, deps: DepsServicio = {}): Promise<void> {
  if (!esAdministradorMensajes(p.correo, deps.env)) throw new ErrorMensaje(403, 'Solo el administrador puede borrar mensajes.');
  if (!fechaIsoValida(p.fecha)) throw new ErrorMensaje(400, 'La fecha no es válida.');
  if (!esNombreArchivoMensaje(p.id)) throw new ErrorMensaje(400, 'El mensaje no es válido.');
  const c = await contexto(deps);
  const res = await c.f(`${c.base}/${p.fecha}/${encodeURIComponent(p.id)}:`, { method: 'DELETE', headers: c.cab });
  if (res.status === 404) throw new ErrorMensaje(404, 'Ese mensaje ya no existe.');
  if (!res.ok) throw new FormacionStorageError(`Graph no borró el mensaje (${res.status}).`, res.status);
}
