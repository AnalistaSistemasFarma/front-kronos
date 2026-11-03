import "server-only";
import { sql, withMssqlPool } from "../mssqlPool";
import { ocultarSecretos } from "./inventory";

/**
 * AUDITORÍA DE AGENTES → COPIAS DE SEGURIDAD (Nicolás, 2026-10-30): qué copias
 * de los agentes se han hecho, en qué fecha y con qué resultado. Fuente: el
 * sistema de respaldo de la flota (repo respaldo-agentes): cada Mac copia sus
 * agentes al NAS (memorias cada hora, todo cada noche) y Acronis lleva el
 * historial. Un recolector de solo lectura (Mac de horus) lee los registros de
 * cada Mac y la validación semanal, y publica aquí.
 * Tablas: prisma/manual/2026-10-30-respaldos-agentes-*.sql (sin modelo Prisma).
 */

export class RespaldosNoDisponibles extends Error {
  constructor() {
    super(
      "La auditoría de copias de seguridad aún no está habilitada en este ambiente.",
    );
  }
}
export class RespaldosValidacionError extends Error {}

type Fila = Record<string, unknown>;
const esAusente = (e: unknown) =>
  (e as { number?: number } | null)?.number === 208;
async function conTablas<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (esAusente(e)) throw new RespaldosNoDisponibles();
    throw e;
  }
}
const iso = (v: unknown) =>
  v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null;
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export interface CopiaDto {
  maquina: string;
  modo: string;
  inicio: string | null;
  fin: string | null;
  segundos: number | null;
  resultado: string;
  avisos: number;
  sqlite: number | null;
  detalle: string | null;
}
export interface MaquinaDto {
  maquina: string;
  etiqueta: string | null;
  alcanzable: boolean;
  ultimoIntento: string | null;
  ultimoContacto: string | null;
  error: string | null;
  agentes: number | null;
  archivos: number | null;
  ultimaCompleta: CopiaDto | null;
  ultimaHoraria: CopiaDto | null;
  validacion: ValidacionDto | null;
}
export interface ValidacionDto {
  fecha: string;
  maquina: string;
  estado: string;
  problemas: string | null;
  avisos: string | null;
}
export interface DiaDto {
  maquina: string;
  dia: string; // AAAA-MM-DD, hora de Colombia
  completas: number;
  completasOk: number;
  horarias: number;
  horariasOk: number;
}
export interface RespaldosDto {
  maquinas: MaquinaDto[];
  dias: DiaDto[];
  copias: CopiaDto[];
  ultimaValidacion: string | null;
  ultimaRecoleccion: string | null;
}

function aCopia(f: Fila): CopiaDto {
  return {
    maquina: String(f.maquina),
    modo: String(f.modo),
    inicio: iso(f.inicio),
    fin: iso(f.fin),
    segundos: num(f.segundos),
    resultado: String(f.resultado),
    avisos: Number(f.avisos ?? 0),
    sqlite: num(f.sqlite),
    detalle: txt(f.detalle),
  };
}

/** Panel: estado por máquina, calendario de 14 días e historial (500 últimas). */
export async function leerRespaldos(): Promise<RespaldosDto> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool.request().query(`
        SELECT * FROM dbo.agent_backup_host ORDER BY maquina;

        SELECT * FROM (
          SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.maquina, r.modo ORDER BY r.inicio DESC) AS rn
          FROM dbo.agent_backup_run r WHERE r.modo IN (N'completo', N'horario')
            AND r.resultado NOT IN (N'sin_terminar', N'omitida')) x
        WHERE x.rn = 1;

        SELECT c.* FROM dbo.agent_backup_check c
        WHERE c.fecha = (SELECT MAX(fecha) FROM dbo.agent_backup_check);

        -- Calendario: últimos 14 días, en hora de Colombia (UTC−5).
        SELECT maquina, CONVERT(char(10), DATEADD(HOUR, -5, inicio), 23) AS dia,
               SUM(CASE WHEN modo = N'completo' THEN 1 ELSE 0 END) AS completas,
               SUM(CASE WHEN modo = N'completo' AND resultado IN (N'ok', N'con_avisos') THEN 1 ELSE 0 END) AS completas_ok,
               SUM(CASE WHEN modo IN (N'horario', N'subida') THEN 1 ELSE 0 END) AS horarias,
               SUM(CASE WHEN modo IN (N'horario', N'subida') AND resultado IN (N'ok', N'con_avisos') THEN 1 ELSE 0 END) AS horarias_ok
        FROM dbo.agent_backup_run
        WHERE inicio >= DATEADD(DAY, -14, SYSUTCDATETIME())
        GROUP BY maquina, CONVERT(char(10), DATEADD(HOUR, -5, inicio), 23);

        SELECT TOP 500 * FROM dbo.agent_backup_run ORDER BY inicio DESC;

        SELECT MAX(fecha) AS ultima_validacion FROM dbo.agent_backup_check;
        SELECT MAX(ultimo_intento) AS ultima_recoleccion FROM dbo.agent_backup_host;
      `),
    );
    const s = r.recordsets as unknown as Fila[][];
    const ultimas = new Map<string, CopiaDto>();
    for (const f of s[1] ?? [])
      ultimas.set(`${f.maquina}|${f.modo}`, aCopia(f));
    const val = new Map<string, ValidacionDto>();
    for (const f of s[2] ?? [])
      val.set(String(f.maquina), {
        fecha: String(iso(f.fecha) ?? "").slice(0, 10),
        maquina: String(f.maquina),
        estado: String(f.estado),
        problemas: txt(f.problemas),
        avisos: txt(f.avisos),
      });
    const maquinas: MaquinaDto[] = (s[0] ?? []).map((f) => {
      const m = String(f.maquina);
      return {
        maquina: m,
        etiqueta: txt(f.etiqueta),
        alcanzable: Boolean(f.alcanzable),
        ultimoIntento: iso(f.ultimo_intento),
        ultimoContacto: iso(f.ultimo_contacto),
        error: txt(f.error),
        agentes: num(f.agentes),
        archivos: num(f.archivos),
        ultimaCompleta: ultimas.get(`${m}|completo`) ?? null,
        ultimaHoraria: ultimas.get(`${m}|horario`) ?? null,
        validacion: val.get(m) ?? null,
      };
    });
    return {
      maquinas,
      dias: (s[3] ?? []).map((f) => ({
        maquina: String(f.maquina),
        dia: String(f.dia),
        completas: Number(f.completas ?? 0),
        completasOk: Number(f.completas_ok ?? 0),
        horarias: Number(f.horarias ?? 0),
        horariasOk: Number(f.horarias_ok ?? 0),
      })),
      copias: (s[4] ?? []).map(aCopia),
      ultimaValidacion: s[5]?.[0]?.ultima_validacion
        ? String(iso(s[5][0].ultima_validacion)).slice(0, 10)
        : null,
      ultimaRecoleccion: iso(s[6]?.[0]?.ultima_recoleccion),
    };
  });
}

// ── Publicación del recolector ────────────────────────────────────────────────

const limpio = (v: unknown, max: number): string | null => {
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
const fechaIso = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const MAQUINA = /^[a-z0-9._-]{1,40}$/;
const MODOS = ["completo", "horario", "subida"];
const RESULTADOS = ["ok", "con_avisos", "fallo", "sin_terminar", "omitida"];

export interface PublicacionRespaldos {
  maquinas: {
    maquina: string;
    etiqueta: string | null;
    alcanzable: boolean;
    error: string | null;
    agentes: number | null;
    archivos: number | null;
  }[];
  copias: {
    maquina: string;
    modo: string;
    inicio: string;
    fin: string | null;
    segundos: number | null;
    resultado: string;
    avisos: number;
    sqlite: number | null;
    detalle: string | null;
  }[];
  validaciones: {
    fecha: string;
    maquina: string;
    estado: string;
    problemas: string | null;
    avisos: string | null;
    datos: string | null;
  }[];
}

export function parsePublicacionRespaldos(body: unknown): PublicacionRespaldos {
  const b = (body ?? {}) as Record<string, unknown>;
  const arr = (v: unknown, max: number) =>
    Array.isArray(v) ? v.slice(0, max) : [];
  const maquinas = arr(b.maquinas, 50)
    .map((x) => x as Record<string, unknown>)
    .filter((x) => typeof x?.maquina === "string" && MAQUINA.test(x.maquina))
    .map((x) => ({
      maquina: String(x.maquina),
      etiqueta: limpio(x.etiqueta, 80),
      alcanzable: x.alcanzable === true,
      error: limpio(x.error, 300),
      agentes: entero(x.agentes),
      archivos: entero(x.archivos),
    }));
  const copias = arr(b.copias, 20_000)
    .map((x) => x as Record<string, unknown>)
    .filter(
      (x) =>
        typeof x?.maquina === "string" &&
        MAQUINA.test(x.maquina) &&
        MODOS.includes(String(x.modo)),
    )
    .map((x) => ({
      maquina: String(x.maquina),
      modo: String(x.modo),
      inicio: fechaIso(x.inicio) ?? "",
      fin: fechaIso(x.fin),
      segundos: entero(x.segundos),
      resultado: RESULTADOS.includes(String(x.resultado))
        ? String(x.resultado)
        : "fallo",
      avisos: entero(x.avisos) ?? 0,
      sqlite: entero(x.sqlite),
      detalle: limpio(x.detalle, 1000),
    }))
    .filter((x) => x.inicio);
  const validaciones = arr(b.validaciones, 500)
    .map((x) => x as Record<string, unknown>)
    .filter(
      (x) =>
        typeof x?.maquina === "string" &&
        MAQUINA.test(x.maquina) &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(x.fecha)),
    )
    .map((x) => ({
      fecha: String(x.fecha),
      maquina: String(x.maquina),
      estado: ["ok", "avisos", "problemas"].includes(String(x.estado))
        ? String(x.estado)
        : "problemas",
      problemas: limpio(x.problemas, 2000),
      avisos: limpio(x.avisos, 2000),
      datos:
        typeof x.datos === "object" && x.datos
          ? JSON.stringify(x.datos).slice(0, 4000)
          : null,
    }));
  if (!maquinas.length && !copias.length && !validaciones.length)
    throw new RespaldosValidacionError("La publicación no trae datos.");
  return { maquinas, copias, validaciones };
}

/** Guarda sin duplicar: copias por (máquina, modo, inicio); validaciones por (fecha, máquina). */
export async function publicarRespaldos(
  p: PublicacionRespaldos,
): Promise<{ copias: number; maquinas: number; validaciones: number }> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("maq", sql.NVarChar(sql.MAX), JSON.stringify(p.maquinas))
        .input("cop", sql.NVarChar(sql.MAX), JSON.stringify(p.copias))
        .input("val", sql.NVarChar(sql.MAX), JSON.stringify(p.validaciones))
        .query(`
          SET XACT_ABORT ON; BEGIN TRAN;
          DECLARE @ahora DATETIME2(0) = SYSUTCDATETIME();
          DECLARE @c TABLE (maquina NVARCHAR(40), modo NVARCHAR(20), inicio DATETIME2(0), fin DATETIME2(0), segundos INT,
                            resultado NVARCHAR(20), avisos INT, sqlite INT, detalle NVARCHAR(1000));
          INSERT INTO @c SELECT maquina, modo, CAST(inicio AS DATETIME2(0)), CAST(fin AS DATETIME2(0)), segundos, resultado, avisos, sqlite, detalle
          FROM OPENJSON(@cop) WITH (maquina NVARCHAR(40), modo NVARCHAR(20), inicio NVARCHAR(40), fin NVARCHAR(40),
               segundos INT, resultado NVARCHAR(20), avisos INT, sqlite INT, detalle NVARCHAR(1000));
          UPDATE r SET fin = c.fin, segundos = c.segundos, resultado = c.resultado, avisos = c.avisos, sqlite = c.sqlite,
                 detalle = c.detalle, recolectado_at = @ahora
          FROM dbo.agent_backup_run r JOIN @c c ON c.maquina = r.maquina AND c.modo = r.modo AND c.inicio = r.inicio
          WHERE r.resultado <> c.resultado OR ISNULL(r.fin, '19000101') <> ISNULL(c.fin, '19000101');
          INSERT INTO dbo.agent_backup_run (maquina, modo, inicio, fin, segundos, resultado, avisos, sqlite, detalle, recolectado_at)
          SELECT c.maquina, c.modo, c.inicio, c.fin, c.segundos, c.resultado, c.avisos, c.sqlite, c.detalle, @ahora FROM @c c
          WHERE NOT EXISTS (SELECT 1 FROM dbo.agent_backup_run r WHERE r.maquina = c.maquina AND r.modo = c.modo AND r.inicio = c.inicio);
          DECLARE @nuevas INT = @@ROWCOUNT;

          MERGE dbo.agent_backup_host AS h
          USING (SELECT * FROM OPENJSON(@maq) WITH (maquina NVARCHAR(40), etiqueta NVARCHAR(80), alcanzable BIT,
                 error NVARCHAR(300), agentes INT, archivos INT)) AS m
          ON h.maquina = m.maquina
          WHEN MATCHED THEN UPDATE SET etiqueta = m.etiqueta, alcanzable = m.alcanzable, ultimo_intento = @ahora,
               ultimo_contacto = CASE WHEN m.alcanzable = 1 THEN @ahora ELSE h.ultimo_contacto END, error = m.error,
               agentes = COALESCE(m.agentes, h.agentes), archivos = COALESCE(m.archivos, h.archivos)
          WHEN NOT MATCHED THEN INSERT (maquina, etiqueta, alcanzable, ultimo_intento, ultimo_contacto, error, agentes, archivos)
               VALUES (m.maquina, m.etiqueta, m.alcanzable, @ahora, CASE WHEN m.alcanzable = 1 THEN @ahora END, m.error, m.agentes, m.archivos);

          MERGE dbo.agent_backup_check AS k
          USING (SELECT * FROM OPENJSON(@val) WITH (fecha DATE, maquina NVARCHAR(40), estado NVARCHAR(20),
                 problemas NVARCHAR(2000), avisos NVARCHAR(2000), datos NVARCHAR(MAX))) AS v
          ON k.fecha = v.fecha AND k.maquina = v.maquina
          WHEN MATCHED THEN UPDATE SET estado = v.estado, problemas = v.problemas, avisos = v.avisos, datos_json = v.datos
          WHEN NOT MATCHED THEN INSERT (fecha, maquina, estado, problemas, avisos, datos_json)
               VALUES (v.fecha, v.maquina, v.estado, v.problemas, v.avisos, v.datos);
          COMMIT TRAN;
          SELECT @nuevas AS nuevas;
        `),
    );
    return {
      copias: Number((r.recordset as Fila[])[0]?.nuevas ?? 0),
      maquinas: p.maquinas.length,
      validaciones: p.validaciones.length,
    };
  });
}
