import { ocultarSecretos } from "./inventory";

/**
 * AUDITORÍA DE AGENTES → INDICADOR DE AUTOMATIZACIONES → AUTOMATIZACIONES
 * PROGRAMADAS (Nicolás, 2026-11-04).
 *
 * El indicador medía solo los casos de uso pedidos en el chat. Muchos agentes
 * además corren solos, por launchd, cron u openclaw cron (p. ej. Carter emite
 * las certificaciones laborales cada día a las 16:00). El recolector de la Mac
 * de horus las inventaría por SSH, en SOLO LECTURA, y publica aquí: qué hace
 * cada una, cuándo corre, cuántas veces corrió en 30 y 90 días, cuántas
 * terminaron bien, su última corrida y una métrica de producción.
 *
 * Lógica pura (validación del cuerpo, % y tendencia), sin base: se prueba en
 * lib/agent-audit/__tests__/scheduled.test.ts. La base va en scheduled-db.ts.
 * Se cuenta APARTE de los casos del chat: no suma horas ahorradas.
 */

export class ProgramadasValidacionError extends Error {}

export const TIPOS_PROGRAMADA = ["launchd", "cron", "openclaw"] as const;
export type TipoProgramada = (typeof TIPOS_PROGRAMADA)[number];
export const ESTADOS_PROGRAMADA = [
  "activa",
  "pausada",
  "fallando",
  "sin_datos",
] as const;
export type EstadoProgramada = (typeof ESTADOS_PROGRAMADA)[number];
export type Tendencia = "sube" | "estable" | "baja" | null;

export interface SemanaProgramada {
  /** Lunes de la semana, AAAA-MM-DD (hora de Colombia). */
  inicio: string;
  corridas: number;
  ok: number;
  produccion: number | null;
}

export interface ProgramadaEntrada {
  /** Id estable: «<host>:<tipo>:<nombre>». */
  clave: string;
  code: string;
  host: string;
  tipo: TipoProgramada;
  nombre: string;
  descripcion: string | null;
  programacion: string | null;
  cargada: boolean | null;
  habilitada: boolean | null;
  estado: EstadoProgramada;
  estadoDetalle: string | null;
  ultimaCorrida: string | null;
  ultimaOk: boolean | null;
  corridas30: number;
  ok30: number;
  corridas90: number;
  ok90: number;
  produccionEtiqueta: string | null;
  produccion30: number | null;
  produccion90: number | null;
  primeraCorrida: string | null;
  semanas: SemanaProgramada[];
}

export interface PublicacionProgramadas {
  corte: string;
  /** Equipos que el recolector alcanzó: sus automatizaciones que ya no aparezcan se borran. */
  hostsLeidos: string[];
  automatizaciones: ProgramadaEntrada[];
}

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = ocultarSecretos(v.replace(/[\u0000-\u001f\u007f]/g, " ").trim());
  return t ? t.slice(0, max) : null;
};
const entero = (v: unknown, min = 0, max = 10_000_000): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.round(n)))
    : null;
};
const bool = (v: unknown): boolean | null =>
  typeof v === "boolean" ? v : null;
const esFecha = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const fechaHora = (v: unknown): string | null => {
  if (typeof v !== "string" || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const HOST = /^[a-z0-9._-]{1,40}$/;

/** Valida lo que publica el recolector. Lanza ProgramadasValidacionError. */
export function parseProgramadas(body: unknown): PublicacionProgramadas {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!esFecha(b.corte))
    throw new ProgramadasValidacionError("Falta corte (AAAA-MM-DD).");
  if (!Array.isArray(b.automatizaciones) || b.automatizaciones.length > 1000)
    throw new ProgramadasValidacionError("Lista de automatizaciones inválida.");
  const hostsLeidos = Array.isArray(b.hostsLeidos)
    ? [
        ...new Set(
          b.hostsLeidos
            .map((h) =>
              String(h ?? "")
                .trim()
                .toLowerCase(),
            )
            .filter((h) => HOST.test(h)),
        ),
      ]
    : [];
  const vistas = new Set<string>();
  const automatizaciones: ProgramadaEntrada[] = [];
  for (const raw of b.automatizaciones) {
    const a = (raw ?? {}) as Record<string, unknown>;
    const code = typeof a.code === "string" ? a.code.trim().toLowerCase() : "";
    const host = typeof a.host === "string" ? a.host.trim().toLowerCase() : "";
    const clave = texto(a.clave, 160);
    const nombre = texto(a.nombre, 200);
    const tipo = TIPOS_PROGRAMADA.find((t) => t === a.tipo);
    if (
      !/^[a-z0-9._-]{1,60}$/.test(code) ||
      !HOST.test(host) ||
      !clave ||
      !nombre ||
      !tipo
    )
      continue;
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    const corridas30 = entero(a.corridas30, 0, 100_000) ?? 0;
    const corridas90 = Math.max(
      corridas30,
      entero(a.corridas90, 0, 100_000) ?? 0,
    );
    const ok30 = Math.min(corridas30, entero(a.ok30, 0, 100_000) ?? 0);
    const ok90 = Math.min(
      corridas90,
      Math.max(ok30, entero(a.ok90, 0, 100_000) ?? 0),
    );
    automatizaciones.push({
      clave,
      code,
      host,
      tipo,
      nombre,
      descripcion: texto(a.descripcion, 1000),
      programacion: texto(a.programacion, 200),
      cargada: bool(a.cargada),
      habilitada: bool(a.habilitada),
      estado: ESTADOS_PROGRAMADA.find((e) => e === a.estado) ?? "sin_datos",
      estadoDetalle: texto(a.estadoDetalle, 400),
      ultimaCorrida: fechaHora(a.ultimaCorrida),
      ultimaOk: bool(a.ultimaOk),
      corridas30,
      ok30,
      corridas90,
      ok90,
      produccionEtiqueta: texto(a.produccionEtiqueta, 120),
      produccion30: entero(a.produccion30),
      produccion90: entero(a.produccion90),
      primeraCorrida: esFecha(a.primeraCorrida) ? a.primeraCorrida : null,
      semanas: Array.isArray(a.semanas)
        ? a.semanas
            .slice(-26)
            .map((w) => {
              const x = (w ?? {}) as Record<string, unknown>;
              const corridas = entero(x.corridas, 0, 100_000) ?? 0;
              return {
                inicio: String(x.inicio ?? ""),
                corridas,
                ok: Math.min(corridas, entero(x.ok, 0, 100_000) ?? 0),
                produccion: entero(x.produccion),
              };
            })
            .filter((w) => esFecha(w.inicio))
        : [],
    });
  }
  return { corte: b.corte, hostsLeidos, automatizaciones };
}

/** % terminado bien (una cifra decimal) o null si no corrió. */
export const pctOk = (ok: number, corridas: number): number | null =>
  corridas > 0 ? Math.round((ok / corridas) * 1000) / 10 : null;

/**
 * Tendencia de las últimas 4 semanas frente a las 4 anteriores: primero la
 * calidad (% bien, ±10 puntos), después el volumen (±25 % de corridas).
 * null si no hay historia suficiente para comparar (p. ej. una automatización nueva).
 */
export function tendencia(
  semanas: SemanaProgramada[],
  corte: string,
): Tendencia {
  const fin = Date.parse(corte);
  if (Number.isNaN(fin)) return null;
  const dia = 86_400_000;
  const rango = (desde: number, hasta: number) =>
    semanas.filter((w) => {
      const t = Date.parse(w.inicio);
      return t > fin - desde * dia && t <= fin - hasta * dia;
    });
  const sum = (ws: SemanaProgramada[], k: "corridas" | "ok") =>
    ws.reduce((s, w) => s + w[k], 0);
  const rec = rango(28, 0);
  const ant = rango(56, 28);
  const cr = sum(rec, "corridas");
  const ca = sum(ant, "corridas");
  // Sin historia anterior (automatización nueva) no hay con qué comparar.
  if (!ca) return null;
  if (!cr) return "baja";
  const dp = (sum(rec, "ok") / cr - sum(ant, "ok") / ca) * 100;
  if (dp >= 10) return "sube";
  if (dp <= -10) return "baja";
  const dv = (cr - ca) / ca;
  if (dv >= 0.25) return "sube";
  if (dv <= -0.25) return "baja";
  return "estable";
}

export interface ResumenProgramadas {
  total: number;
  activas: number;
  pausadas: number;
  fallando: number;
  corridas30: number;
  ok30: number;
  pctOk30: number | null;
}

export function resumirProgramadas(
  xs: { estado: string; corridas30: number; ok30: number }[],
): ResumenProgramadas {
  const corridas30 = xs.reduce((s, x) => s + x.corridas30, 0);
  const ok30 = xs.reduce((s, x) => s + x.ok30, 0);
  return {
    total: xs.length,
    activas: xs.filter((x) => x.estado === "activa").length,
    pausadas: xs.filter((x) => x.estado === "pausada").length,
    fallando: xs.filter((x) => x.estado === "fallando").length,
    corridas30,
    ok30,
    pctOk30: pctOk(ok30, corridas30),
  };
}
