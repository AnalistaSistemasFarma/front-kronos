import { createHash } from 'node:crypto';
import { ocultarSecretos } from './inventory';

/**
 * AUDITORÍA DE AGENTES → ERRORES DE IA (Nicolás, 2026-11-03: «como un Sentry
 * pero con los agentes»). Lógica PURA (sin base): validación de lo que publica
 * el recolector, huella de agrupación y regla de notificación. La base está en
 * errors-db.ts y las tablas en prisma/manual/2026-11-03-errores-ia-*.sql.
 *
 * El recolector (scripts/agent-errors/recolector_errores.py, Mac de horus)
 * lee en SOLO LECTURA los logs de los 5 equipos y manda eventos sueltos; aquí
 * se agrupan por HUELLA = agente + tipo + ambiente + primera línea normalizada
 * (sin números, ids, horas ni rutas temporales), igual que Sentry agrupa por
 * «fingerprint». Cada evento trae una CLAVE propia: el recolector relee los
 * logs en cada ronda y la clave evita contar dos veces la misma línea.
 */

import {
  AMBIENTES,
  SEVERIDADES,
  TIPOS_ERROR,
  type Ambiente,
  type EstadoError,
  type Severidad,
  type TipoError,
} from './errors-catalog';

export * from './errors-catalog';

/** Tope de eventos por publicación (el recolector parte en lotes). */
export const MAX_EVENTOS = 2000;

export class ErroresValidacionError extends Error {}

export interface EventoError {
  agente: string;
  host: string | null;
  tipo: TipoError;
  severidad: Severidad;
  ambiente: Ambiente;
  titulo: string;
  detalle: string | null;
  huella: string;
  eventoClave: string;
  ocurrioEn: Date;
  idConversacion: number | null;
  idMensaje: number | null;
}

export interface PublicacionErrores {
  host: string | null;
  version: string | null;
  eventos: EventoError[];
}

const limpiar = (v: string) => v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');

function texto(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = ocultarSecretos(limpiar(v).trim());
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function entero(v: unknown): number | null {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}

function enumerado<T extends readonly string[]>(v: unknown, permitidos: T): T[number] | null {
  return typeof v === 'string' && (permitidos as readonly string[]).includes(v) ? (v as T[number]) : null;
}

/**
 * Primera línea NORMALIZADA: lo que distingue un error de otro, sin lo que
 * cambia en cada ocurrencia (números, ids, horas, hex, rutas temporales).
 * «falló el turno del mensaje 26723: el turno excedió 900s» y el mismo con
 * 26801 dan la misma huella.
 */
export function normalizarTitulo(titulo: string): string {
  const primera = (titulo.split('\n')[0] ?? '').slice(0, 400).toLowerCase();
  return primera
    .replace(/\d{4}-\d{2}-\d{2}[t ][\d:.]+z?/g, '<fecha>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<id>')
    .replace(/\b[0-9a-f]{12,}\b/g, '<hex>')
    .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/\S*/g, '<tmp>')
    .replace(/\d+/g, 'N')
    .replace(/N[.,]N/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export function calcularHuella(agente: string, tipo: string, ambiente: string, titulo: string): string {
  return createHash('sha256')
    .update([agente.toLowerCase(), tipo, ambiente, normalizarTitulo(titulo)].join('|'))
    .digest('hex');
}

export function calcularClaveEvento(huella: string, clave: string): string {
  return createHash('sha256').update(`${huella}|${clave}`).digest('hex');
}

/** Valida y normaliza lo que publica el recolector. La huella se calcula AQUÍ. */
export function parsePublicacion(body: unknown, ahora: Date = new Date()): PublicacionErrores {
  if (!body || typeof body !== 'object') throw new ErroresValidacionError('Cuerpo vacío.');
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.eventos)) throw new ErroresValidacionError('Falta la lista «eventos».');
  if (b.eventos.length > MAX_EVENTOS)
    throw new ErroresValidacionError(`Máximo ${MAX_EVENTOS} eventos por publicación.`);
  const host = texto(b.host, 60);
  const eventos: EventoError[] = [];
  const limiteFuturo = ahora.getTime() + 10 * 60_000;
  for (const crudo of b.eventos) {
    if (!crudo || typeof crudo !== 'object') continue;
    const e = crudo as Record<string, unknown>;
    const agente = typeof e.agente === 'string' ? e.agente.trim().toLowerCase() : '';
    if (!/^[a-z0-9._-]{1,60}$/.test(agente)) continue;
    const tipo = enumerado(e.tipo, TIPOS_ERROR) ?? 'otro';
    const severidad = enumerado(e.severidad, SEVERIDADES) ?? 'media';
    const ambiente = enumerado(e.ambiente, AMBIENTES);
    const titulo = texto(e.titulo, 300);
    const clave = typeof e.clave === 'string' ? e.clave.slice(0, 300) : '';
    const fecha = typeof e.ocurrioEn === 'string' ? new Date(e.ocurrioEn) : null;
    if (!ambiente || !titulo || !clave || !fecha || Number.isNaN(fecha.getTime())) continue;
    if (fecha.getTime() > limiteFuturo) continue;
    const huella = calcularHuella(agente, tipo, ambiente, titulo);
    eventos.push({
      agente,
      host: texto(e.host, 60) ?? host,
      tipo,
      severidad,
      ambiente,
      titulo,
      detalle: texto(e.detalle, 1000),
      huella,
      eventoClave: calcularClaveEvento(huella, clave),
      ocurrioEn: fecha,
      idConversacion: entero(e.idConversacion),
      idMensaje: entero(e.idMensaje),
    });
  }
  return { host, version: texto(b.version, 20), eventos };
}

/** Lista de huellas que el recolector ya avisó (acuse de la notificación). */
export function parseAcuse(body: unknown): string[] {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(b.huellas)) throw new ErroresValidacionError('Falta la lista «huellas».');
  const out = b.huellas.filter((h): h is string => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h));
  if (out.length > 500) throw new ErroresValidacionError('Demasiadas huellas.');
  return [...new Set(out)];
}

export interface EstadoParaNotificar {
  severidad: Severidad;
  estado: EstadoError;
  nueva: boolean; // la huella apareció en esta publicación
  reabierta: boolean; // estaba «resuelto» y volvió a pasar
  eventosNuevos: number;
  notificadoEn: Date | null;
}

/**
 * ¿Hay que avisarle a Nicolás? (diseño aprobado 2026-11-03)
 *   - silenciado: nunca.
 *   - huella NUEVA o REABIERTA con severidad media/alta: sí (una vez).
 *   - severidad alta que sigue pasando: sí, pero no más de una vez cada
 *     `horas` horas desde el último aviso.
 *   - severidad baja: solo queda en el panel.
 */
export function debeNotificar(e: EstadoParaNotificar, ahora: Date, horas: number): boolean {
  if (e.estado === 'silenciado' || e.eventosNuevos <= 0) return false;
  if (e.severidad === 'baja') return false;
  if (e.nueva || e.reabierta) return true;
  if (e.severidad !== 'alta') return false;
  if (!e.notificadoEn) return true;
  return ahora.getTime() - e.notificadoEn.getTime() >= horas * 3_600_000;
}

/** Horas mínimas entre avisos del mismo error (AGENT_ERRORS_NOTIFY_HOURS, por defecto 6). */
export function horasEntreAvisos(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.AGENT_ERRORS_NOTIFY_HOURS);
  return Number.isFinite(n) && n >= 1 && n <= 168 ? n : 6;
}

/** Bandera de notificación. Apagada salvo AGENT_ERRORS_NOTIFY=1 (en pruebas queda apagada). */
export function notificacionActiva(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENT_ERRORS_NOTIFY ?? '').trim() === '1';
}
