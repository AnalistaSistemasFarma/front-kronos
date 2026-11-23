/**
 * Fechas del módulo de Salas, siempre en hora de Bogotá.
 *
 * Colombia no tiene horario de verano: el offset es fijo (-05:00). Por eso las
 * fechas viajan como texto `YYYY-MM-DD` y las horas como `HH:mm`, y solo se
 * convierten a instante (ISO con offset) al hablar con Graph. Todo es puro y
 * sin dependencias: se prueba en lib/salas/__tests__.
 */

export const OFFSET_BOGOTA = '-05:00';
/** Nombre de zona de Windows que entiende Graph para Bogotá. */
export const ZONA_GRAPH = 'SA Pacific Standard Time';

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** ¿Es una fecha `YYYY-MM-DD` real (no 2026-02-30)? */
export function esFecha(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !FECHA_RE.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

/** ¿Es una hora `HH:mm` de 00:00 a 23:59? */
export function esHora(valor: unknown): valor is string {
  return typeof valor === 'string' && HORA_RE.test(valor);
}

function utc(fecha: string): Date {
  return new Date(`${fecha}T00:00:00Z`);
}

function texto(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Suma (o resta) días a una fecha `YYYY-MM-DD`. */
export function sumarDias(fecha: string, dias: number): string {
  const d = utc(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return texto(d);
}

/** Misma fecha N años después; el 29 de febrero pasa al 28 si el año no es bisiesto. */
export function sumarAnios(fecha: string, anios: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const ultimo = diasDelMes(a + anios, m);
  return `${String(a + anios).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

/** Días del mes (mes 1-12). */
export function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Día de la semana: 0 = domingo … 6 = sábado. */
export function diaSemana(fecha: string): number {
  return utc(fecha).getUTCDay();
}

/** Días enteros de `desde` a `hasta` (negativo si `hasta` es anterior). */
export function diferenciaDias(desde: string, hasta: string): number {
  return Math.round((utc(hasta).getTime() - utc(desde).getTime()) / 86_400_000);
}

/** Fecha de hoy en Bogotá. */
export function hoyBogota(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** Instante ISO con offset de Bogotá: `2026-11-17T08:30:00-05:00`. */
export function isoBogota(fecha: string, hora: string): string {
  return `${fecha}T${hora}:00${OFFSET_BOGOTA}`;
}

/** Milisegundos epoch de una fecha y hora de Bogotá. */
export function msBogota(fecha: string, hora: string): number {
  return new Date(isoBogota(fecha, hora)).getTime();
}

/**
 * Rango de `calendarView` para uno o varios días completos, CON offset -05:00.
 * (`Prefer: outlook.timezone` solo cambia el formato de la respuesta, no el filtro.)
 */
export function rangoDias(desde: string, hasta: string = desde): { inicio: string; fin: string } {
  return {
    inicio: `${desde}T00:00:00${OFFSET_BOGOTA}`,
    fin: `${sumarDias(hasta, 1)}T00:00:00${OFFSET_BOGOTA}`,
  };
}

/**
 * Convierte el `dateTime` que devuelve Graph (en hora de Bogotá gracias a
 * `Prefer: outlook.timezone`) a fecha y hora locales.
 */
export function partesGraph(dateTime: string): { fecha: string; hora: string } {
  return { fecha: dateTime.slice(0, 10), hora: dateTime.slice(11, 16) };
}
