/**
 * MEDIDOR DEL CONSUMO DE ANTHROPIC — reglas puras (2026-10-22).
 *
 * Autorización de Nicolás Rivera (2026-10-22, 07:03 COT, «de una»): en el
 * encabezado de TODOS los proyectos, para todos los usuarios, el cupo semanal
 * y la ventana de 5 h del token con el que trabaja el agente del proyecto.
 *
 * El dato lo publica el puente de hilos (puente-hilos/src/cuota.mjs) por
 * POST /api/chat/agent/quota: lo toma del `rate_limit_event` del stream de cada
 * turno y, sin turnos, de una consulta mínima cada 5 min. Es el consumo del
 * TOKEN: lo comparten el bot vivo y los demás agentes que usen el mismo token.
 *
 * Aquí: validación del reporte, colores por umbral y textos en hora de
 * Colombia (UTC−5 todo el año, sin horario de verano).
 */

export type FuenteCuota = 'turno' | 'sonda';

/** Reporte ya validado, listo para guardar. */
export interface CuotaReportada {
  utilizacion7d: number | null;
  reset7d: Date | null;
  utilizacion5h: number | null;
  reset5h: Date | null;
  overage: string | null;
  medidoEn: Date;
  fuente: FuenteCuota;
}

/** Lo que la interfaz recibe por agente (GET /api/proyectos/<id>/consumo). */
export interface CuotaAgenteDto {
  code: string;
  displayName: string;
  utilizacion7d: number | null;
  reset7d: string | null;
  utilizacion5h: number | null;
  reset5h: string | null;
  overage: string | null;
  medidoEn: string;
  fuente: FuenteCuota;
}

export const UMBRAL_AMARILLO = 70;
export const UMBRAL_ROJO = 90;
/** Más vieja que esto, la medición se marca como desactualizada. */
export const MEDICION_VIEJA_MS = 20 * 60 * 1000;
/** Tope del porcentaje (con excedente puede pasar de 100; más que esto es un dato absurdo). */
const MAX_PORCENTAJE = 1000;
/** Una medición «del futuro» más allá de esto viene de un reloj desfasado. */
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;
/** Un reinicio a más de 8 días no es de ninguna de las dos ventanas. */
const MAX_RESET_MS = 8 * 24 * 60 * 60 * 1000;

type Resultado<T> = { ok: true; value: T } | { ok: false; error: string };

function porcentaje(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PORCENTAJE) return undefined;
  return Math.round(n * 10) / 10;
}

function fecha(raw: unknown): Date | null | undefined {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Valida el cuerpo de POST /api/chat/agent/quota. Nunca lanza. */
export function normalizarCuota(payload: Record<string, unknown> | null, ahora: Date = new Date()): Resultado<CuotaReportada> {
  if (!payload) return { ok: false, error: 'El cuerpo debe ser un objeto JSON.' };
  const u7 = porcentaje(payload.utilizacion7d);
  const u5 = porcentaje(payload.utilizacion5h);
  if (u7 === undefined || u5 === undefined) return { ok: false, error: `La utilización debe ser un porcentaje entre 0 y ${MAX_PORCENTAJE}.` };
  if (u7 === null && u5 === null) return { ok: false, error: 'El reporte no trae ninguna ventana.' };

  const r7 = fecha(payload.reset7d);
  const r5 = fecha(payload.reset5h);
  if (r7 === undefined || r5 === undefined) return { ok: false, error: 'Las fechas de reinicio deben ser ISO 8601.' };
  for (const r of [r7, r5]) {
    if (r && Math.abs(r.getTime() - ahora.getTime()) > MAX_RESET_MS) return { ok: false, error: 'Fecha de reinicio fuera de rango.' };
  }

  const medido = fecha(payload.medidoEn);
  if (!medido) return { ok: false, error: 'Falta medidoEn (ISO 8601).' };
  if (medido.getTime() - ahora.getTime() > TOLERANCIA_FUTURO_MS) return { ok: false, error: 'medidoEn está en el futuro.' };

  const fuente = payload.fuente;
  if (fuente !== 'turno' && fuente !== 'sonda') return { ok: false, error: "fuente debe ser 'turno' o 'sonda'." };

  const overageCrudo = payload.overage;
  const overage = typeof overageCrudo === 'string' && overageCrudo.trim() ? overageCrudo.trim().slice(0, 40) : null;

  return { ok: true, value: { utilizacion7d: u7, reset7d: r7, utilizacion5h: u5, reset5h: r5, overage, medidoEn: medido, fuente } };
}

/** Verde, amarillo desde el 70 % y rojo desde el 90 %. */
export function colorDeUso(pct: number | null): 'green' | 'yellow' | 'red' | 'gray' {
  if (pct === null || !Number.isFinite(pct)) return 'gray';
  if (pct >= UMBRAL_ROJO) return 'red';
  if (pct >= UMBRAL_AMARILLO) return 'yellow';
  return 'green';
}

/** «40 %» (sin decimales salvo que haga falta: «99,5 %»). */
export function textoPorcentaje(pct: number | null): string {
  if (pct === null) return '—';
  const r = Math.round(pct * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1).replace('.', ',')} %`;
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const COT_MS = -5 * 60 * 60 * 1000;

/** La fecha vista en Colombia, como una Date en UTC con los campos de COT. */
function enCot(d: Date): Date {
  return new Date(d.getTime() + COT_MS);
}

function diaCot(d: Date): string {
  const c = enCot(d);
  return `${c.getUTCFullYear()}-${c.getUTCMonth()}-${c.getUTCDate()}`;
}

/** «5:00 p. m.» en hora de Colombia. */
export function horaCot(d: Date): string {
  const c = enCot(d);
  const h = c.getUTCHours();
  const m = String(c.getUTCMinutes()).padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** «jue 23 oct, 5:00 p. m.» en hora de Colombia. */
export function diaHoraCot(d: Date): string {
  const c = enCot(d);
  return `${DIAS[c.getUTCDay()]} ${c.getUTCDate()} ${MESES[c.getUTCMonth()]}, ${horaCot(d)}`;
}

/** «se reinicia jue 23 oct, 5:00 p. m.» */
export function textoReinicioSemanal(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `se reinicia ${diaHoraCot(d)}`;
}

/** «se libera a las 5:00 p. m.»; si no es hoy (en Colombia), con el día. */
export function textoLiberaCinco(iso: string | null, ahora: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return diaCot(d) === diaCot(ahora) ? `se libera a las ${horaCot(d)}` : `se libera el ${diaHoraCot(d)}`;
}

/** «hace 3 min», «hace 2 h». */
export function textoHace(iso: string, ahora: Date = new Date()): string {
  const ms = Math.max(0, ahora.getTime() - new Date(iso).getTime());
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'hace menos de un minuto';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

export interface VistaBarra {
  etiqueta: string;
  valor: number;
  porcentaje: string;
  color: ReturnType<typeof colorDeUso>;
  detalle: string | null;
}

export interface VistaCuota {
  semanal: VistaBarra | null;
  cinco: VistaBarra | null;
  /** «Medido el jue 23 oct, 9:36 a. m. (hace 3 min) · durante un turno» */
  medicion: string;
  vieja: boolean;
}

/**
 * Lo que pinta el componente. Si el reinicio ya pasó (el dato quedó viejo), el
 * porcentaje de esa ventana ya no vale: se muestra 0 % con «se reinició».
 */
export function vistaCuota(dto: CuotaAgenteDto, ahora: Date = new Date()): VistaCuota {
  const barra = (
    etiqueta: string,
    pct: number | null,
    reset: string | null,
    texto: (iso: string | null) => string | null
  ): VistaBarra | null => {
    if (pct === null) return null;
    const vencido = reset !== null && new Date(reset).getTime() <= ahora.getTime();
    const valor = vencido ? 0 : pct;
    return {
      etiqueta,
      valor: Math.min(100, Math.max(0, valor)),
      porcentaje: textoPorcentaje(valor),
      color: colorDeUso(valor),
      detalle: vencido ? 'se reinició; esperando la próxima medición' : texto(reset),
    };
  };
  const medido = new Date(dto.medidoEn);
  return {
    semanal: barra('Semanal', dto.utilizacion7d, dto.reset7d, textoReinicioSemanal),
    cinco: barra('Ventana de 5 h', dto.utilizacion5h, dto.reset5h, (iso) => textoLiberaCinco(iso, ahora)),
    medicion: `Medido el ${diaHoraCot(medido)} (${textoHace(dto.medidoEn, ahora)})${dto.fuente === 'turno' ? ' · durante un turno' : ''}`,
    vieja: ahora.getTime() - medido.getTime() > MEDICION_VIEJA_MS,
  };
}

/**
 * Detalle del tooltip de la píldora compacta (2026-10-22), en el orden en que se lee:
 * «Semanal 42 % · se reinicia sáb 24 oct, 5:00 p. m.», «Ventana de 5 h 31 % · se libera a las
 * 10:50 a. m.», «Token del agente (compartido)» y la hora de la medición.
 */
export function lineasDetalleCuota(v: VistaCuota): string[] {
  const linea = (b: VistaBarra | null) => (b ? `${b.etiqueta} ${b.porcentaje}${b.detalle ? ` · ${b.detalle}` : ''}` : null);
  return [
    linea(v.semanal),
    linea(v.cinco),
    'Consumo del token del agente (compartido)',
    v.medicion,
    v.vieja ? 'La medición está desactualizada: el puente no ha reportado en los últimos minutos.' : null,
  ].filter((l): l is string => Boolean(l));
}
