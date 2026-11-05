import "server-only";
import { sql, withMssqlPool } from "../mssqlPool";
import { agentInScope, type AuditScope } from "../chat/audit-access";
import { ocultarSecretos } from "./inventory";

/**
 * AUDITORÍA DE AGENTES → INDICADOR DE AUTOMATIZACIONES (Nicolás, 2026-10-30):
 * por agente, el tiempo ANTES (humano realista sin IA) vs DESPUÉS (la persona
 * pidiendo y revisando) de cada caso de uso, con las ocurrencias medidas en el
 * chat y las horas ahorradas. Un analizador de solo lectura (Mac de horus)
 * recalcula cada semana o cuando alguien pulsa «Analizar ahora».
 *
 * Tablas: prisma/manual/2026-10-30-indicador-automatizaciones-*.sql (sin modelo Prisma).
 * Agentes personales (agent_memory_setting.private_owner_email): solo su dueño.
 */

export class IndicadorNoDisponible extends Error {
  constructor() {
    super(
      "El indicador de automatizaciones aún no está habilitado en este ambiente.",
    );
  }
}
export class IndicadorValidacionError extends Error {}

type Fila = Record<string, unknown>;
const esAusente = (e: unknown) =>
  (e as { number?: number } | null)?.number === 208;
async function conTablas<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (esAusente(e)) throw new IndicadorNoDisponible();
    throw e;
  }
}
const fecha = (v: unknown) =>
  v instanceof Date && !Number.isNaN(v.getTime())
    ? v.toISOString().slice(0, 10)
    : null;
const fechaHora = (v: unknown) =>
  v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));

export interface PasoDto {
  paso: string;
  minutos: number;
}
export interface CasoIndicadorDto {
  clave: string;
  caso: string;
  descripcion: string | null;
  clase: string | null;
  area: string | null;
  entregable: string | null;
  ocurrencias: number;
  minHumano: number;
  minHumanoMin: number | null;
  minHumanoMax: number | null;
  minDespues: number;
  minAgente: number | null;
  horasAntes: number;
  horasDespues: number;
  horasAhorradas: number;
  horasMes: number;
  pasos: PasoDto[];
  supuestos: string | null;
  confianza: string | null;
  valido: boolean;
}
export interface AgenteIndicadorDto {
  idAgent: number;
  code: string;
  displayName: string;
  empresa: string | null;
  departamento: string | null;
  casos: number;
  casosValidos: number;
  ocurrencias: number;
  horasAntes: number;
  horasDespues: number;
  horasAhorradas: number;
  horasMes: number;
  reduccion: number | null;
}
export interface CorridaDto {
  id: number;
  origen: string;
  status: string;
  requestedBy: string | null;
  requestedAt: string | null;
  finishedAt: string | null;
  corte: string | null;
  tareas: number | null;
  tareasSinClasificar: number | null;
  error: string | null;
}
/** Mapa de calor (% de mejora por departamento y semana) y barras por departamento. */
export interface GraficosDto {
  semanas: string[];
  departamentos: {
    departamento: string;
    horasSinIA: number;
    horasConIA: number;
    mejora: number | null;
    celdas: {
      semana: string;
      horasSinIA: number;
      horasConIA: number;
      mejora: number | null;
    }[];
  }[];
}
export interface IndicadorDto {
  corte: string | null;
  periodoDesde: string | null;
  semanas: number | null;
  agentes: AgenteIndicadorDto[];
  ultima: CorridaDto | null;
  pendiente: CorridaDto | null;
  graficos: GraficosDto;
}

function aCorrida(f: Fila | undefined): CorridaDto | null {
  if (!f) return null;
  return {
    id: Number(f.id_run),
    origen: String(f.origen),
    status: String(f.status),
    requestedBy: txt(f.requested_by),
    requestedAt: fechaHora(f.requested_at),
    finishedAt: fechaHora(f.finished_at),
    corte: fecha(f.corte),
    tareas: num(f.tareas),
    tareasSinClasificar: num(f.tareas_sin_clasificar),
    error: txt(f.error_summary),
  };
}

const FILTRO_PERSONAL = `(ms.private_owner_email IS NULL OR LOWER(ms.private_owner_email) = @email)`;

/** Resumen por agente del corte más reciente + estado de las corridas. */
export async function leerIndicador(
  email: string,
  alcance: AuditScope,
): Promise<IndicadorDto> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("email", sql.NVarChar(200), email.trim().toLowerCase()).query(`
        DECLARE @corte DATE = (SELECT MAX(corte) FROM dbo.agent_automation_case);
        SELECT c.id_agent, a.code, a.display_name, LTRIM(RTRIM(co.company)) AS empresa,
               (SELECT TOP 1 su.departamento FROM dbo.agent_use_summary su
                 WHERE su.id_agent = a.id_agent ORDER BY su.corte DESC) AS departamento,
               COUNT(*) AS casos, SUM(CAST(c.valido AS INT)) AS validos,
               SUM(CASE WHEN c.valido = 1 THEN c.ocurrencias ELSE 0 END) AS ocurrencias,
               SUM(c.horas_antes) AS antes, SUM(c.horas_despues) AS despues,
               SUM(c.horas_ahorradas) AS ahorradas, SUM(c.horas_mes) AS mes,
               MIN(c.periodo_desde) AS desde, MAX(c.corte) AS corte
        FROM dbo.agent_automation_case c
        JOIN dbo.agent a ON a.id_agent = c.id_agent
        LEFT JOIN dbo.agent_company ac ON ac.id_agent = a.id_agent AND ac.is_primary = 1
        LEFT JOIN dbo.company co ON co.id_company = ac.id_company
        LEFT JOIN dbo.agent_memory_setting ms ON ms.id_agent = a.id_agent
        WHERE c.corte = @corte AND a.is_active = 1 AND ${FILTRO_PERSONAL}
        GROUP BY c.id_agent, a.code, a.display_name, co.company, a.id_agent;

        SELECT TOP 1 * FROM dbo.agent_automation_run WHERE status IN ('terminado','fallido')
          ORDER BY COALESCE(finished_at, requested_at) DESC;
        SELECT TOP 1 * FROM dbo.agent_automation_run WHERE status IN ('pendiente','en_curso')
          ORDER BY requested_at DESC;

        -- Casos válidos con su detalle por semana (gráficos).
        SELECT c.id_agent, c.min_humano, c.min_despues, c.semanas_json
        FROM dbo.agent_automation_case c
        WHERE c.corte = @corte AND c.valido = 1;
      `),
    );
    const sets = r.recordsets as unknown as Fila[][];
    let corte: string | null = null;
    let desde: string | null = null;
    const agentes: AgenteIndicadorDto[] = [];
    for (const f of sets[0] ?? []) {
      const id = Number(f.id_agent);
      if (!agentInScope(alcance, id)) continue;
      corte = fecha(f.corte);
      desde = fecha(f.desde);
      const antes = Number(f.antes ?? 0);
      const despues = Number(f.despues ?? 0);
      agentes.push({
        idAgent: id,
        code: String(f.code),
        displayName: String(f.display_name),
        empresa: txt(f.empresa),
        departamento: txt(f.departamento),
        casos: Number(f.casos ?? 0),
        casosValidos: Number(f.validos ?? 0),
        ocurrencias: Number(f.ocurrencias ?? 0),
        horasAntes: antes,
        horasDespues: despues,
        horasAhorradas: Number(f.ahorradas ?? 0),
        horasMes: Number(f.mes ?? 0),
        reduccion:
          antes > 0 ? Math.round((1 - despues / antes) * 1000) / 10 : null,
      });
    }
    agentes.sort((a, b) => b.horasMes - a.horasMes);
    const semanas =
      corte && desde
        ? Math.round(
            ((Date.parse(corte) - Date.parse(desde)) / 86_400_000 / 7) * 10,
          ) / 10
        : null;
    return {
      corte,
      periodoDesde: desde,
      semanas,
      agentes,
      ultima: aCorrida(sets[1]?.[0]),
      pendiente: aCorrida(sets[2]?.[0]),
      graficos: armarGraficos(agentes, sets[3] ?? []),
    };
  });
}

const SIN_DEPTO = "Sin departamento";

/** «SISTEMAS 🖥️» → «SISTEMAS»; vacío o «Pendiente…» → «Sin departamento». */
function nombreDepto(v: string | null): string {
  const t = (v ?? "")
    .replace(/[^\p{L}\p{N} .,&()/-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || /^pendiente|^sin dato|^sin departamento/i.test(t)) return SIN_DEPTO;
  return t.toUpperCase();
}

/**
 * Mapa de calor y barras por departamento. El departamento es el del agente
 * (el más repetido entre sus operadores). % de mejora = 1 − horas con IA /
 * horas sin IA, por departamento y semana (lunes de cada semana).
 */
function armarGraficos(
  agentes: AgenteIndicadorDto[],
  casos: Fila[],
): GraficosDto {
  const depto = new Map(
    agentes.map((a) => [a.idAgent, nombreDepto(a.departamento)]),
  );
  const tot = new Map<string, { sin: number; con: number }>();
  for (const a of agentes) {
    const d = depto.get(a.idAgent)!;
    const t = tot.get(d) ?? { sin: 0, con: 0 };
    t.sin += a.horasAntes;
    t.con += a.horasDespues;
    tot.set(d, t);
  }
  const celdas = new Map<string, Map<string, { sin: number; con: number }>>();
  const semanas = new Set<string>();
  for (const c of casos) {
    const d = depto.get(Number(c.id_agent));
    if (!d) continue; // fuera del alcance o personal de otro
    let ws: { inicio?: unknown; ocurrencias?: unknown }[] = [];
    try {
      const v = JSON.parse(String(c.semanas_json ?? "[]"));
      if (Array.isArray(v)) ws = v;
    } catch {
      ws = [];
    }
    const mh = Number(c.min_humano ?? 0);
    const md = Number(c.min_despues ?? 0);
    for (const w of ws) {
      const s = String(w.inicio ?? "");
      const n = Number(w.ocurrencias ?? 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !n) continue;
      semanas.add(s);
      const porSemana = celdas.get(d) ?? new Map();
      const x = porSemana.get(s) ?? { sin: 0, con: 0 };
      x.sin += (n * mh) / 60;
      x.con += (n * md) / 60;
      porSemana.set(s, x);
      celdas.set(d, porSemana);
    }
  }
  const lista = [...semanas].sort();
  const pct = (sin: number, con: number) =>
    sin > 0 ? Math.round((1 - con / sin) * 1000) / 10 : null;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    semanas: lista,
    departamentos: [...tot.entries()]
      .map(([departamento, t]) => ({
        departamento,
        horasSinIA: r1(t.sin),
        horasConIA: r1(t.con),
        mejora: pct(t.sin, t.con),
        celdas: lista.map((semana) => {
          const x = celdas.get(departamento)?.get(semana) ?? { sin: 0, con: 0 };
          return {
            semana,
            horasSinIA: r1(x.sin),
            horasConIA: r1(x.con),
            mejora: pct(x.sin, x.con),
          };
        }),
      }))
      .filter((d) => d.horasSinIA > 0)
      .sort((a, b) => b.horasSinIA - a.horasSinIA),
  };
}

/** Casos de UN agente (su ficha). null si no existe o no está en el alcance. */
export async function leerIndicadorAgente(
  code: string,
  email: string,
  alcance: AuditScope,
): Promise<{
  agente: AgenteIndicadorDto;
  casos: CasoIndicadorDto[];
  corte: string | null;
  periodoDesde: string | null;
} | null> {
  const general = await leerIndicador(email, alcance);
  const agente = general.agentes.find((a) => a.code === code);
  if (!agente) return null;
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool.request().input("id", sql.Int, agente.idAgent).query(`
        DECLARE @corte DATE = (SELECT MAX(corte) FROM dbo.agent_automation_case);
        SELECT * FROM dbo.agent_automation_case
        WHERE corte = @corte AND id_agent = @id
        ORDER BY valido DESC, horas_ahorradas DESC, ocurrencias DESC;
      `),
    );
    const casos = (r.recordset as Fila[]).map((f) => {
      let pasos: PasoDto[] = [];
      try {
        const p = JSON.parse(String(f.pasos_json ?? "[]"));
        if (Array.isArray(p))
          pasos = p
            .map((x) => ({
              paso: String(x?.paso ?? x?.descripcion ?? x?.nombre ?? ""),
              minutos: Number(x?.minutos ?? x?.min ?? 0),
            }))
            .filter((x) => x.paso);
      } catch {
        pasos = [];
      }
      return {
        clave: String(f.clave),
        caso: String(f.caso),
        descripcion: txt(f.descripcion),
        clase: txt(f.clase),
        area: txt(f.area),
        entregable: txt(f.entregable),
        ocurrencias: Number(f.ocurrencias ?? 0),
        minHumano: Number(f.min_humano ?? 0),
        minHumanoMin: num(f.min_humano_min),
        minHumanoMax: num(f.min_humano_max),
        minDespues: Number(f.min_despues ?? 0),
        minAgente: num(f.min_agente),
        horasAntes: Number(f.horas_antes ?? 0),
        horasDespues: Number(f.horas_despues ?? 0),
        horasAhorradas: Number(f.horas_ahorradas ?? 0),
        horasMes: Number(f.horas_mes ?? 0),
        pasos,
        supuestos: txt(f.supuestos),
        confianza: txt(f.confianza),
        valido: Boolean(f.valido),
      };
    });
    return {
      agente,
      casos,
      corte: general.corte,
      periodoDesde: general.periodoDesde,
    };
  });
}

/** Botón «Analizar ahora»: deja una corrida pendiente (una sola a la vez). */
export async function pedirAnalisis(email: string): Promise<CorridaDto> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool.request().input("email", sql.NVarChar(200), email.trim()).query(`
        SET XACT_ABORT ON; BEGIN TRAN;
        DECLARE @id INT = (SELECT TOP 1 id_run FROM dbo.agent_automation_run WITH (UPDLOCK, HOLDLOCK)
                           WHERE status IN ('pendiente','en_curso') ORDER BY requested_at DESC);
        IF @id IS NULL
        BEGIN
          INSERT INTO dbo.agent_automation_run (origen, status, requested_by, requested_at)
          VALUES (N'manual', N'pendiente', @email, SYSUTCDATETIME());
          SET @id = SCOPE_IDENTITY();
        END
        COMMIT TRAN;
        SELECT * FROM dbo.agent_automation_run WHERE id_run = @id;
      `),
    );
    return aCorrida((r.recordset as Fila[])[0])!;
  });
}

/** Analizador: toma la corrida pendiente más antigua (o null). */
export async function tomarCorrida(): Promise<CorridaDto | null> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool.request().query(`
        SET XACT_ABORT ON; BEGIN TRAN;
        -- Una corrida tomada hace más de 2 horas se da por perdida.
        UPDATE dbo.agent_automation_run SET status = N'fallido', finished_at = SYSUTCDATETIME(),
               error_summary = N'El analizador tomó la corrida y no terminó a tiempo.'
        WHERE status = N'en_curso' AND started_at < DATEADD(HOUR, -2, SYSUTCDATETIME());
        DECLARE @id INT = (SELECT TOP 1 id_run FROM dbo.agent_automation_run WITH (UPDLOCK, READPAST)
                           WHERE status = N'pendiente' ORDER BY requested_at);
        IF @id IS NOT NULL
          UPDATE dbo.agent_automation_run SET status = N'en_curso', started_at = SYSUTCDATETIME() WHERE id_run = @id;
        COMMIT TRAN;
        SELECT * FROM dbo.agent_automation_run WHERE id_run = @id;
      `),
    );
    return aCorrida((r.recordset as Fila[])[0]);
  });
}

export interface CasoEntrada {
  code: string;
  clave: string;
  caso: string;
  descripcion: string | null;
  clase: string | null;
  area: string | null;
  entregable: string | null;
  terminos: string | null;
  ocurrencias: number;
  minHumano: number;
  minHumanoMin: number | null;
  minHumanoMax: number | null;
  minDespues: number;
  minAgente: number | null;
  pasos: PasoDto[];
  supuestos: string | null;
  confianza: string | null;
  valido: boolean;
  /** Veces por semana: [{inicio:"AAAA-MM-DD", ocurrencias}] (mapa de calor). */
  semanas: { inicio: string; ocurrencias: number }[];
}
export interface PublicacionIndicador {
  idRun: number | null;
  origen: "manual" | "programado" | "carga";
  corte: string;
  periodoDesde: string;
  tareas: number | null;
  tareasSinClasificar: number | null;
  error: string | null;
  casos: CasoEntrada[];
}

const limpio = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = ocultarSecretos(v.replace(/[\u0000-\u001f\u007f]/g, " ").trim());
  return t ? t.slice(0, max) : null;
};
const entero = (v: unknown, min = 0, max = 100_000): number | null => {
  // null/undefined/"" son «sin dato», no 0 (Number(null) === 0 convertía un
  // idRun vacío en la corrida #1 y la sobrescribía).
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.round(n)))
    : null;
};
const esFecha = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Valida lo que publica el analizador. Lanza IndicadorValidacionError. */
export function parsePublicacion(body: unknown): PublicacionIndicador {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!esFecha(b.corte) || !esFecha(b.periodoDesde))
    throw new IndicadorValidacionError(
      "Faltan corte o periodoDesde (AAAA-MM-DD).",
    );
  if (!Array.isArray(b.casos) || b.casos.length > 3000)
    throw new IndicadorValidacionError("Lista de casos inválida.");
  const origen =
    b.origen === "manual" || b.origen === "programado" ? b.origen : "carga";
  const casos: CasoEntrada[] = [];
  for (const raw of b.casos) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const code = typeof c.code === "string" ? c.code.trim().toLowerCase() : "";
    const clave = limpio(c.clave, 40);
    const caso = limpio(c.caso, 300);
    if (!/^[a-z0-9._-]{1,60}$/.test(code) || !clave || !caso) continue;
    const minHumano = entero(c.minHumano, 0, 10_000) ?? 0;
    const minDespues = Math.min(
      minHumano,
      entero(c.minDespues, 0, 10_000) ?? 0,
    );
    const pasos = Array.isArray(c.pasos)
      ? c.pasos
          .slice(0, 12)
          .map((p) => {
            const x = (p ?? {}) as Record<string, unknown>;
            return {
              paso: limpio(x.paso, 200) ?? "",
              minutos: entero(x.minutos, 0, 10_000) ?? 0,
            };
          })
          .filter((p) => p.paso)
      : [];
    const ma = Number(c.minAgente);
    casos.push({
      code,
      clave,
      caso,
      descripcion: limpio(c.descripcion, 1000),
      clase: limpio(c.clase, 30),
      area: limpio(c.area, 120),
      entregable: limpio(c.entregable, 300),
      terminos: limpio(c.terminos, 400),
      ocurrencias: entero(c.ocurrencias, 0, 1_000_000) ?? 0,
      minHumano,
      minHumanoMin: entero(c.minHumanoMin, 0, 10_000),
      minHumanoMax: entero(c.minHumanoMax, 0, 10_000),
      minDespues,
      minAgente:
        Number.isFinite(ma) && ma >= 0 ? Math.round(ma * 10) / 10 : null,
      pasos,
      supuestos: limpio(c.supuestos, 600),
      confianza: ["alta", "media", "baja"].includes(String(c.confianza))
        ? String(c.confianza)
        : null,
      valido: c.valido !== false && minHumano > 0,
      semanas: Array.isArray(c.semanas)
        ? c.semanas
            .slice(0, 120)
            .map((w) => {
              const x = (w ?? {}) as Record<string, unknown>;
              return {
                inicio: String(x.inicio ?? ""),
                ocurrencias: entero(x.ocurrencias, 0, 1_000_000) ?? 0,
              };
            })
            .filter((w) => esFecha(w.inicio))
        : [],
    });
  }
  return {
    idRun: entero(b.idRun, 1, 2_000_000_000),
    origen,
    corte: String(b.corte),
    periodoDesde: String(b.periodoDesde),
    tareas: entero(b.tareas, 0, 10_000_000),
    tareasSinClasificar: entero(b.tareasSinClasificar, 0, 10_000_000),
    error: limpio(b.error, 1000),
    casos,
  };
}

/**
 * Publica un corte: reemplaza los casos de ese corte, calcula las horas en el
 * servidor (no se confía en las del analizador) y cierra la corrida.
 */
export async function publicarIndicador(
  p: PublicacionIndicador,
): Promise<{ casos: number; idRun: number }> {
  return conTablas(async () => {
    const dias = Math.max(
      1,
      (Date.parse(p.corte) - Date.parse(p.periodoDesde)) / 86_400_000,
    );
    const factorMes = 30.44 / dias;
    const filas = p.casos.map((c) => {
      const v = c.valido ? c.ocurrencias : 0;
      const antes = (v * c.minHumano) / 60;
      const despues = (v * c.minDespues) / 60;
      return {
        ...c,
        horasAntes: Math.round(antes * 10) / 10,
        horasDespues: Math.round(despues * 10) / 10,
        horasAhorradas: Math.round((antes - despues) * 10) / 10,
        horasMes: Math.round((antes - despues) * factorMes * 10) / 10,
        pasosJson: JSON.stringify(c.pasos),
        semanasJson: JSON.stringify(c.semanas),
      };
    });
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("corte", sql.Date, p.corte)
        .input("desde", sql.Date, p.periodoDesde)
        .input("idRun", sql.Int, p.idRun)
        .input("origen", sql.NVarChar(20), p.origen)
        .input("tareas", sql.Int, p.tareas)
        .input("sin", sql.Int, p.tareasSinClasificar)
        .input("error", sql.NVarChar(1000), p.error)
        .input("casos", sql.NVarChar(sql.MAX), JSON.stringify(filas)).query(`
          SET XACT_ABORT ON; BEGIN TRAN;
          DECLARE @run INT = @idRun;
          IF @run IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.agent_automation_run WHERE id_run = @run)
          BEGIN
            INSERT INTO dbo.agent_automation_run (origen, status, requested_at, started_at)
            VALUES (@origen, N'en_curso', SYSUTCDATETIME(), SYSUTCDATETIME());
            SET @run = SCOPE_IDENTITY();
          END
          DELETE FROM dbo.agent_automation_case WHERE corte = @corte;
          INSERT INTO dbo.agent_automation_case (id_run, corte, periodo_desde, id_agent, clave, caso, descripcion,
                 clase, area, entregable, terminos, ocurrencias, min_humano, min_humano_min, min_humano_max,
                 min_despues, min_agente, horas_antes, horas_despues, horas_ahorradas, horas_mes, pasos_json,
                 supuestos, confianza, valido, semanas_json)
          SELECT @run, @corte, @desde, a.id_agent, j.clave, j.caso, j.descripcion, j.clase, j.area, j.entregable,
                 j.terminos, j.ocurrencias, j.minHumano, j.minHumanoMin, j.minHumanoMax, j.minDespues, j.minAgente,
                 j.horasAntes, j.horasDespues, j.horasAhorradas, j.horasMes, j.pasosJson, j.supuestos, j.confianza, j.valido, j.semanasJson
          FROM OPENJSON(@casos) WITH (
                 code NVARCHAR(60) '$.code', clave NVARCHAR(40) '$.clave', caso NVARCHAR(300) '$.caso',
                 descripcion NVARCHAR(1000) '$.descripcion', clase NVARCHAR(30) '$.clase', area NVARCHAR(120) '$.area',
                 entregable NVARCHAR(300) '$.entregable', terminos NVARCHAR(400) '$.terminos',
                 ocurrencias INT '$.ocurrencias', minHumano INT '$.minHumano', minHumanoMin INT '$.minHumanoMin',
                 minHumanoMax INT '$.minHumanoMax', minDespues INT '$.minDespues', minAgente DECIMAL(8,1) '$.minAgente',
                 horasAntes DECIMAL(10,1) '$.horasAntes', horasDespues DECIMAL(10,1) '$.horasDespues',
                 horasAhorradas DECIMAL(10,1) '$.horasAhorradas', horasMes DECIMAL(10,1) '$.horasMes',
                 pasosJson NVARCHAR(MAX) '$.pasosJson', supuestos NVARCHAR(600) '$.supuestos',
                 confianza NVARCHAR(10) '$.confianza', valido BIT '$.valido',
                 semanasJson NVARCHAR(MAX) '$.semanasJson') j
          JOIN dbo.agent a ON a.code = j.code;
          DECLARE @n INT = @@ROWCOUNT;
          UPDATE dbo.agent_automation_run SET status = CASE WHEN @error IS NULL THEN N'terminado' ELSE N'fallido' END,
                 finished_at = SYSUTCDATETIME(), corte = @corte, periodo_desde = @desde, tareas = @tareas,
                 tareas_sin_clasificar = @sin, error_summary = @error
          WHERE id_run = @run;
          COMMIT TRAN;
          SELECT @n AS casos, @run AS id_run;
        `),
    );
    const f = (r.recordset as Fila[])[0] ?? {};
    return { casos: Number(f.casos ?? 0), idRun: Number(f.id_run ?? 0) };
  });
}

/** El analizador avisa que una corrida falló sin publicar. */
export async function fallarCorrida(
  idRun: number,
  error: string,
): Promise<void> {
  await conTablas(() =>
    withMssqlPool((pool) =>
      pool
        .request()
        .input("id", sql.Int, idRun)
        .input(
          "error",
          sql.NVarChar(1000),
          limpio(error, 1000) ?? "Error sin detalle",
        ).query(`
          UPDATE dbo.agent_automation_run SET status = N'fallido', finished_at = SYSUTCDATETIME(),
                 error_summary = @error WHERE id_run = @id AND status IN (N'pendiente', N'en_curso');
        `),
    ),
  );
}
