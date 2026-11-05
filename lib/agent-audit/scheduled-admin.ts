import catalogo from '../../scripts/agent-automation/programadas-catalogo.json';
import { pareceCorriendo } from './scheduled-salud';

/**
 * ADMINISTRAR LAS AUTOMATIZACIONES PROGRAMADAS desde el Indicador (Nicolás,
 * 2026-11-04: «todas las automatizaciones de los agentes deberían poder verse
 * y administrarse desde ahí»). Parte PURA: acciones, LISTA BLANCA y reglas de
 * cuándo se puede pedir cada acción. La base está en scheduled-admin-db.ts.
 *
 * Mismo patrón que «Limpiar contexto» (#798): la pantalla NO toca ningún Mac.
 * Registra una ORDEN (quién, cuándo, IP, navegador) y el ejecutor del Mac de
 * esa automatización la toma, la aplica y reporta el resultado:
 *   - pausar   = launchctl bootout + disable + renombrar el plist (sobrevive a un
 *                reinicio, como el apagado del Curador) · openclaw cron disable
 *   - reanudar = devolver el plist + enable + bootstrap · openclaw cron enable
 *   - ejecutar = launchctl kickstart (sin -k: no mata una corrida en curso) ·
 *                openclaw cron run
 *
 * LISTA BLANCA ESTRICTA (aquí y otra vez en el ejecutor): solo las
 * automatizaciones de NEGOCIO del catálogo (scripts/agent-automation/
 * programadas-catalogo.json), nunca el bot principal ni la infraestructura de
 * la flota (puentes, rotación, Curador, recolectores, túneles, gateway…). Las
 * de cron no se administran desde aquí (habría que editar el crontab).
 */

export const ACCIONES_PROGRAMADA = ['pausar', 'reanudar', 'ejecutar'] as const;
export type AccionProgramada = (typeof ACCIONES_PROGRAMADA)[number];
export const esAccion = (v: unknown): v is AccionProgramada =>
  typeof v === 'string' && (ACCIONES_PROGRAMADA as readonly string[]).includes(v);

export const NOMBRE_ACCION: Record<AccionProgramada, string> = {
  pausar: 'Pausar',
  reanudar: 'Reanudar',
  ejecutar: 'Ejecutar ahora',
};

/** Una orden que nadie tomó en este tiempo vence (el ejecutor pasa cada minuto). */
export const ORDEN_PROG_PENDIENTE_VENCE_MS = 15 * 60_000;
/** Una orden tomada sin resultado en este tiempo vence (las acciones tardan segundos). */
export const ORDEN_PROG_EN_CURSO_VENCE_MS = 10 * 60_000;

/**
 * Infraestructura que JAMÁS se administra desde la pantalla, aunque alguien la
 * agregue al catálogo por error (mismos patrones que excluye el recolector).
 */
const PROHIBIDAS = [
  /\.learn$/i,
  /\.curador$/i,
  /rotacion|rotate|session-rotat|semanal-sesion/i,
  /bridge|puente|hilos/i,
  /fleet-|internal-ping/i,
  /agent-inventory|agent-automation|agent-errors|agent-cv|agent-memories|contexto-agentes|automatizaciones-ejecutor/i,
  /watchdog|monitor|usage|keepalive|healthcheck|vigilante/i,
  /disable-autoupdater|autoupdate|update/i,
  /cloudflared|tunnel|tunel|gateway|\.tui$|restart|kickstart/i,
  /serfarma07/i,
];

const CATALOGO = catalogo as unknown as Record<string, unknown>;
const RE_LABEL = /^com\.[A-Za-z0-9._-]{3,150}$/;
const labelValido = (l: string) => RE_LABEL.test(l) && !l.includes('..') && !l.endsWith('.');
const RE_OPENCLAW = /^openclaw:([a-z0-9._-]{1,40}):([A-Za-z0-9_-]{1,80})$/;
const RE_HOST = /^[a-z0-9._-]{1,40}$/;

export interface Administrable {
  ok: boolean;
  motivo: string | null;
}

/** ¿Esta automatización se puede administrar desde la pantalla? (lista blanca) */
export function esAdministrable(p: { tipo: string; ref: string | null; host: string }): Administrable {
  const no = (motivo: string): Administrable => ({ ok: false, motivo });
  if (p.tipo === 'cron') return no('Las automatizaciones de cron no se administran desde aquí (habría que editar el crontab del equipo).');
  if (p.tipo !== 'launchd' && p.tipo !== 'openclaw') return no('Tipo de automatización no administrable.');
  if (!RE_HOST.test(p.host) || /serfarma/i.test(p.host)) return no('Equipo no administrable.');
  const ref = p.ref ?? '';
  if (!ref) return no('El recolector aún no publicó su identificador; se habilita en su próxima pasada.');
  if (!Object.prototype.hasOwnProperty.call(CATALOGO, ref) || ref.startsWith('_'))
    return no('No está en el catálogo de automatizaciones de negocio.');
  const entrada = CATALOGO[ref] as { excluir?: boolean } | null;
  if (entrada?.excluir) return no('Excluida en el catálogo.');
  if (p.tipo === 'launchd') {
    if (!labelValido(ref)) return no('Identificador de launchd no válido.');
  } else {
    const m = RE_OPENCLAW.exec(ref);
    if (!m || m[1] !== p.host) return no('Identificador de openclaw no válido.');
  }
  if (PROHIBIDAS.some((rx) => rx.test(ref))) return no('Es infraestructura de la flota: no se administra desde aquí.');
  return { ok: true, motivo: null };
}

export interface JobParaAccion {
  tipo: string;
  ref: string | null;
  host: string;
  cargada: boolean | null;
  habilitada: boolean | null;
  estado: string;
  ultimaCorrida: string | null;
  ultimaOk: boolean | null;
}

export const estaPausada = (j: Pick<JobParaAccion, 'cargada' | 'habilitada' | 'estado'>) =>
  j.cargada === false || j.habilitada === false || j.estado === 'pausada';

/**
 * ¿Se puede pedir esta acción ahora? Devuelve el motivo si no (409 en la API).
 * La orden activa y los permisos se revisan aparte (base y sesión).
 */
export function motivoNoPermitida(accion: AccionProgramada, j: JobParaAccion, ahora: Date = new Date()): string | null {
  const adm = esAdministrable(j);
  if (!adm.ok) return adm.motivo;
  const pausada = estaPausada(j);
  if (accion === 'pausar' && pausada) return 'Ya está pausada.';
  if (accion === 'reanudar' && !pausada) return 'No está pausada.';
  if (accion === 'ejecutar' && pausada) return 'Está pausada: reanúdela antes de ejecutarla.';
  if (accion !== 'reanudar' && pareceCorriendo(j, ahora))
    return 'Parece estar corriendo en este momento. Espere a que termine e intente de nuevo.';
  return null;
}

/** Texto del estado de una orden para la pantalla y la hoja de vida. */
export function textoOrdenProgramada(accion: AccionProgramada, estado: string): string {
  const a = NOMBRE_ACCION[accion].toLowerCase();
  switch (estado) {
    case 'pendiente':
      return `Pendiente: esperando a que el equipo la tome para ${a} (hasta 1 min).`;
    case 'en_curso':
      return `En curso: el equipo está aplicando «${NOMBRE_ACCION[accion]}».`;
    case 'ok':
      return accion === 'pausar'
        ? 'Pausada en el equipo.'
        : accion === 'reanudar'
          ? 'Reanudada en el equipo.'
          : 'Lanzada en el equipo; el resultado se verá en su próxima lectura.';
    case 'ocupado':
      return 'No se aplicó: la automatización estaba corriendo. Intente de nuevo en unos minutos.';
    case 'error':
      return `No se pudo ${a}.`;
    case 'vencida':
      return 'Venció: el equipo no la tomó o no reportó a tiempo (¿ejecutor apagado?).';
    default:
      return estado;
  }
}

/* ───────────────────────── Llaves del ejecutor ───────────────────────── */

/**
 * Llaves del EJECUTOR de cada Mac: AGENT_SCHEDULED_EXECUTOR_KEYS =
 * "local:<llave>,jorge:<llave>,…" (al menos 32 caracteres cada una). Cada llave
 * solo ve y reporta las órdenes de SU equipo: si se filtra la de un Mac, no
 * sirve para administrar los demás ni para leer nada más. Cerrado por defecto.
 */
export function llavesEjecutor(env: NodeJS.ProcessEnv = process.env): { host: string; llave: string }[] {
  const out: { host: string; llave: string }[] = [];
  for (const parte of (env.AGENT_SCHEDULED_EXECUTOR_KEYS ?? '').split(',')) {
    const i = parte.indexOf(':');
    if (i <= 0) continue;
    const host = parte.slice(0, i).trim().toLowerCase();
    const llave = parte.slice(i + 1).trim();
    if (RE_HOST.test(host) && llave.length >= 32) out.push({ host, llave });
  }
  return out;
}
