/**
 * AUTOMATIZACIONES PROGRAMADAS → ¿SE MURIÓ ALGUNA? (Nicolás, 2026-11-04:
 * «así podemos estar pendientes de que alguna automatización se nos murió»).
 *
 * Lógica PURA, sin base ni dependencias: la usan el servidor (lectura, aviso
 * en Errores de IA) y la pantalla. Se prueba en __tests__/scheduled-salud.test.ts.
 *
 * A partir de la PROGRAMACIÓN (hora fija por días, o cada N minutos) se calcula
 * cuándo debió ser la última corrida. Si pasó el margen sin corrida, la
 * automatización está «Muerta / no corrió»; si sus últimas corridas fallaron,
 * está «Fallando». Se evalúa a la hora en que el recolector la vio por última
 * vez (visto_at), no a la hora de la consulta: entre dos pasadas del recolector
 * nada «se muere» solo porque pasó el tiempo sin datos nuevos.
 *
 * Los equipos de la flota están en hora de Colombia (UTC−5 fija, sin horario de
 * verano), igual que los StartCalendarInterval de launchd y los cron.
 */

/** Una franja de la programación. Días: wd = día de la semana (0 = domingo; 7 también es domingo en launchd), d = día del mes. */
export interface FranjaHorario {
  wd?: number;
  d?: number;
  /** Sin hora = cada hora, al minuto m. */
  h?: number;
  m?: number;
}

/** Programación estructurada que publica el recolector. */
export type Horario = { cada: number } | { cal: FranjaHorario[] };

export interface CorridaResumen {
  /** ISO UTC. */
  ts: string;
  /** null = empezó hace poco y puede seguir corriendo. */
  ok: boolean | null;
  produccion: number | null;
  /** Línea de error del log (solo en las que fallaron), sin secretos. */
  nota: string | null;
}

export const SALUDES = ['muerta', 'fallando', 'pausada', 'ok', 'sin_datos'] as const;
export type Salud = (typeof SALUDES)[number];

export const NOMBRE_SALUD: Record<Salud, { label: string; color: string }> = {
  muerta: { label: 'Muerta / no corrió', color: 'red' },
  fallando: { label: 'Fallando', color: 'red' },
  pausada: { label: 'Pausada', color: 'gray' },
  ok: { label: 'Activa', color: 'green' },
  sin_datos: { label: 'Sin datos', color: 'yellow' },
};

/** Orden para la pantalla: lo que necesita atención, arriba. */
export const ORDEN_SALUD: Record<Salud, number> = { muerta: 0, fallando: 1, sin_datos: 2, ok: 3, pausada: 4 };

export const tieneProblema = (s: Salud | null | undefined) => s === 'muerta' || s === 'fallando';

/** Tolerancia de reloj: una corrida que empezó poco antes de su hora cuenta. */
const TOLERANCIA_MS = 10 * 60_000;
/** Margen tras la hora fija antes de declararla muerta (pedido: «1 h después de la hora diaria»). */
export const MARGEN_CALENDARIO_MS = 60 * 60_000;
/** Para las de cada N minutos: muerta si pasan 2 × N sin correr (mínimo 20 min). */
export const FACTOR_INTERVALO = 2;
const MIN_MARGEN_INTERVALO_MS = 20 * 60_000;
/** Una corrida «sin terminar» más vieja que esto ya no se considera en curso. */
export const EN_CURSO_MAX_MS = 3 * 3_600_000;
const COT_MS = 5 * 3_600_000;
const DIA_MS = 86_400_000;

const entre = (v: unknown, min: number, max: number): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

/** Valida la programación que manda el recolector. null si no sirve (p. ej. «una vez»). */
export function parseHorario(v: unknown): Horario | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if ('cada' in o) {
    const n = entre(o.cada, 1, 60 * 24 * 31);
    return n ? { cada: n } : null;
  }
  if (Array.isArray(o.cal)) {
    const cal: FranjaHorario[] = [];
    for (const x of o.cal.slice(0, 200)) {
      if (!x || typeof x !== 'object') continue;
      const f = x as Record<string, unknown>;
      const franja: FranjaHorario = {};
      const wd = entre(f.wd, 0, 7);
      const d = entre(f.d, 1, 31);
      const h = entre(f.h, 0, 23);
      const m = entre(f.m, 0, 59);
      if (f.wd !== undefined && f.wd !== null && wd === undefined) continue;
      if (f.d !== undefined && f.d !== null && d === undefined) continue;
      if (f.h !== undefined && f.h !== null && h === undefined) continue;
      if (wd !== undefined) franja.wd = wd % 7;
      if (d !== undefined) franja.d = d;
      if (h !== undefined) franja.h = h;
      franja.m = m ?? 0;
      cal.push(franja);
    }
    return cal.length ? { cal } : null;
  }
  return null;
}

/** Cada cuántos minutos corre, en promedio (para saber cuántas fallas seguidas son alarma). */
export function intervaloMinutos(h: Horario): number {
  if ('cada' in h) return h.cada;
  let porSemana = 0;
  for (const f of h.cal) {
    const horas = f.h === undefined ? 24 : 1;
    const dias = f.wd !== undefined ? 1 : f.d !== undefined ? 7 / 30 : 7;
    porSemana += horas * dias;
  }
  return porSemana > 0 ? (7 * 24 * 60) / porSemana : 7 * 24 * 60;
}

/**
 * Última hora programada que es ≤ `antes` (busca hasta 40 días atrás), o null.
 * Solo para programaciones por calendario.
 */
export function ultimaEsperada(h: Horario, antes: Date): Date | null {
  if ('cada' in h) return null;
  const tope = antes.getTime();
  // Día de Colombia de `antes`.
  const cot = new Date(tope - COT_MS);
  const y = cot.getUTCFullYear();
  const mo = cot.getUTCMonth();
  const d0 = cot.getUTCDate();
  for (let atras = 0; atras <= 40; atras++) {
    const dia = new Date(Date.UTC(y, mo, d0 - atras));
    const wd = dia.getUTCDay();
    const dm = dia.getUTCDate();
    let mejor = -Infinity;
    for (const f of h.cal) {
      if (f.wd !== undefined && f.wd !== wd) continue;
      if (f.d !== undefined && f.d !== dm) continue;
      const horas = f.h === undefined ? Array.from({ length: 24 }, (_, i) => i) : [f.h];
      for (const hh of horas) {
        const t = dia.getTime() + hh * 3_600_000 + (f.m ?? 0) * 60_000 + COT_MS;
        if (t <= tope && t > mejor) mejor = t;
      }
    }
    if (mejor > -Infinity) return new Date(mejor);
  }
  return null;
}

/** «2026-11-04 16:00» en hora de Colombia. */
export function fechaCot(d: Date): string {
  return new Date(d.getTime() - COT_MS).toISOString().slice(0, 16).replace('T', ' ');
}

/** Fallas seguidas al final (las que siguen en curso no cuentan ni cortan). */
export function fallasSeguidas(ultimas: CorridaResumen[]): number {
  const xs = [...ultimas].sort((a, b) => a.ts.localeCompare(b.ts));
  let n = 0;
  for (let i = xs.length - 1; i >= 0; i--) {
    const ok = xs[i].ok;
    if (ok === null) continue;
    if (ok) break;
    n++;
  }
  return n;
}

/**
 * Cuántas fallas seguidas son alarma: las que corren a diario o menos seguido
 * avisan a la primera (dos fallas = dos días perdidos); las frecuentes, a la segunda.
 */
export function umbralFallas(h: Horario | null): number {
  return h && intervaloMinutos(h) < 20 * 60 ? 2 : 1;
}

export interface EntradaSalud {
  cargada: boolean | null;
  habilitada: boolean | null;
  /** Estado que calculó el recolector (respaldo cuando no hay programación estructurada). */
  estado: string;
  estadoDetalle: string | null;
  ultimaCorrida: string | null;
  ultimaOk: boolean | null;
  horario: Horario | null;
  ultimas: CorridaResumen[];
  vistoAt: string | null;
}

export interface ResultadoSalud {
  salud: Salud;
  detalle: string | null;
  /** Hora programada que no se cumplió (solo «muerta» por calendario), ISO. */
  esperada: string | null;
}

/** Evalúa una automatización. `ahora` se inyecta para las pruebas. */
export function evaluarSalud(e: EntradaSalud, ahora: Date = new Date()): ResultadoSalud {
  if (e.cargada === false || e.habilitada === false || e.estado === 'pausada')
    return { salud: 'pausada', detalle: e.estadoDetalle ?? 'Pausada: no corre.', esperada: null };

  const visto = e.vistoAt ? Date.parse(e.vistoAt) : NaN;
  const ref = Number.isNaN(visto) ? ahora.getTime() : Math.min(ahora.getTime(), visto);
  const ult = e.ultimaCorrida ? Date.parse(e.ultimaCorrida) : NaN;
  const hayUltima = !Number.isNaN(ult);
  const ultTxt = hayUltima ? fechaCot(new Date(ult)) : null;

  // 1) ¿Dejó de correr?
  if (e.horario && hayUltima) {
    if ('cada' in e.horario) {
      const margen = Math.max(FACTOR_INTERVALO * e.horario.cada * 60_000, MIN_MARGEN_INTERVALO_MS);
      if (ref - ult > margen)
        return {
          salud: 'muerta',
          detalle: `Debía correr cada ${e.horario.cada} min y la última corrida fue el ${ultTxt}.`,
          esperada: new Date(ult + e.horario.cada * 60_000).toISOString(),
        };
    } else {
      const esperada = ultimaEsperada(e.horario, new Date(ref - MARGEN_CALENDARIO_MS));
      if (esperada && ult < esperada.getTime() - TOLERANCIA_MS)
        return {
          salud: 'muerta',
          detalle: `Debía correr el ${fechaCot(esperada)} y no corrió (última corrida: ${ultTxt}).`,
          esperada: esperada.toISOString(),
        };
    }
  }

  // 2) ¿Sus últimas corridas fallaron?
  const umbral = umbralFallas(e.horario);
  if (e.ultimas.length) {
    const n = fallasSeguidas(e.ultimas);
    if (n >= umbral)
      return {
        salud: 'fallando',
        detalle: n === 1 ? 'La última corrida falló.' : `Fallaron las últimas ${n} corridas.`,
        esperada: null,
      };
  } else if (e.ultimaOk === false) {
    return { salud: 'fallando', detalle: e.estadoDetalle ?? 'La última corrida falló.', esperada: null };
  }

  // 3) Sin programación estructurada: lo que dijo el recolector.
  if (!e.horario && e.estado === 'fallando')
    return { salud: 'fallando', detalle: e.estadoDetalle, esperada: null };
  if (!hayUltima) return { salud: 'sin_datos', detalle: e.estadoDetalle ?? 'Sin corridas registradas.', esperada: null };
  return { salud: 'ok', detalle: e.estadoDetalle, esperada: null };
}

/** ¿Parece estar corriendo ahora? (última corrida reciente sin resultado). */
export function pareceCorriendo(
  p: { ultimaCorrida: string | null; ultimaOk: boolean | null },
  ahora: Date = new Date(),
): boolean {
  if (!p.ultimaCorrida || p.ultimaOk !== null) return false;
  const t = Date.parse(p.ultimaCorrida);
  return !Number.isNaN(t) && ahora.getTime() - t < EN_CURSO_MAX_MS;
}
