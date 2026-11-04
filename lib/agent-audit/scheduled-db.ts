import "server-only";
import { sql, withMssqlPool } from "../mssqlPool";
import { agentInScope, type AuditScope } from "../chat/audit-access";
import {
  pctOk,
  tendencia,
  type EstadoProgramada,
  type ProgramadaEntrada,
  type PublicacionProgramadas,
  type SemanaProgramada,
  type Tendencia,
  type TipoProgramada,
} from "./scheduled";

/**
 * AUTOMATIZACIONES PROGRAMADAS de los agentes (Indicador de automatizaciones,
 * Nicolás 2026-11-04). Una fila por automatización (clave estable), con su
 * último estado y su historia semanal (semanas_json) para la tendencia.
 *
 * Tabla: prisma/manual/2026-11-04-automatizaciones-programadas-*.sql (sin modelo
 * Prisma). Si la tabla no existe, las lecturas devuelven null y el indicador
 * del chat sigue funcionando igual.
 * Agentes personales (agent_memory_setting.private_owner_email): solo su dueño.
 */

export class ProgramadasNoDisponible extends Error {
  constructor() {
    super(
      "Las automatizaciones programadas aún no están habilitadas en este ambiente.",
    );
  }
}

type Fila = Record<string, unknown>;
const esAusente = (e: unknown) =>
  (e as { number?: number } | null)?.number === 208;
const fecha = (v: unknown) =>
  v instanceof Date && !Number.isNaN(v.getTime())
    ? v.toISOString().slice(0, 10)
    : null;
const fechaHora = (v: unknown) =>
  v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
const bit = (v: unknown) => (v === null || v === undefined ? null : Boolean(v));

export interface ProgramadaDto extends Omit<
  ProgramadaEntrada,
  "semanas" | "tipo" | "estado"
> {
  idAgent: number;
  displayName: string;
  empresa: string | null;
  tipo: TipoProgramada;
  estado: EstadoProgramada;
  pctOk30: number | null;
  pctOk90: number | null;
  tendencia: Tendencia;
  semanas: SemanaProgramada[];
  corte: string | null;
  vistoAt: string | null;
}

/**
 * La reja de agentes personales vive en agent_memory_setting (pase de
 * Memorias, 2026-10-29). Si ese pase no está en el ambiente, no hay agentes
 * personales: se consulta sin la tabla en lugar de fallar (igual que errors-db).
 */
let conMemorias: boolean | null = null;
async function hayMemorias(): Promise<boolean> {
  if (conMemorias === null) {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .query(`SELECT OBJECT_ID(N'dbo.agent_memory_setting', N'U') AS t`),
    );
    const t = (r.recordset as Fila[])[0]?.t;
    conMemorias = t !== null && t !== undefined;
  }
  return conMemorias;
}

function aDto(f: Fila): ProgramadaDto {
  let semanas: SemanaProgramada[] = [];
  try {
    const v = JSON.parse(String(f.semanas_json ?? "[]"));
    if (Array.isArray(v))
      semanas = v
        .map((w) => ({
          inicio: String(w?.inicio ?? ""),
          corridas: Number(w?.corridas ?? 0),
          ok: Number(w?.ok ?? 0),
          produccion:
            w?.produccion === null || w?.produccion === undefined
              ? null
              : Number(w.produccion),
        }))
        .filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.inicio));
  } catch {
    semanas = [];
  }
  const corte = fecha(f.corte);
  const corridas30 = Number(f.corridas_30 ?? 0);
  const ok30 = Number(f.ok_30 ?? 0);
  const corridas90 = Number(f.corridas_90 ?? 0);
  const ok90 = Number(f.ok_90 ?? 0);
  return {
    idAgent: Number(f.id_agent),
    code: String(f.code),
    displayName: String(f.display_name),
    empresa: txt(f.empresa),
    clave: String(f.clave),
    host: String(f.host),
    tipo: String(f.tipo) as TipoProgramada,
    nombre: String(f.nombre),
    descripcion: txt(f.descripcion),
    programacion: txt(f.programacion),
    cargada: bit(f.cargada),
    habilitada: bit(f.habilitada),
    estado: String(f.estado) as EstadoProgramada,
    estadoDetalle: txt(f.estado_detalle),
    ultimaCorrida: fechaHora(f.ultima_corrida),
    ultimaOk: bit(f.ultima_ok),
    corridas30,
    ok30,
    corridas90,
    ok90,
    pctOk30: pctOk(ok30, corridas30),
    pctOk90: pctOk(ok90, corridas90),
    produccionEtiqueta: txt(f.produccion_etiqueta),
    produccion30: num(f.produccion_30),
    produccion90: num(f.produccion_90),
    primeraCorrida: fecha(f.primera_corrida),
    semanas,
    tendencia: corte ? tendencia(semanas, corte) : null,
    corte,
    vistoAt: fechaHora(f.visto_at),
  };
}

/**
 * Automatizaciones programadas visibles para quien consulta (todas o las de
 * un agente). null si la tabla aún no existe en el ambiente.
 */
export async function leerProgramadas(
  email: string,
  alcance: AuditScope,
  code?: string,
): Promise<ProgramadaDto[] | null> {
  try {
    const memorias = await hayMemorias();
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("email", sql.NVarChar(200), email.trim().toLowerCase())
        .input("code", sql.NVarChar(60), code ?? null).query(`
        SELECT j.*, a.code, a.display_name, LTRIM(RTRIM(co.company)) AS empresa
        FROM dbo.agent_scheduled_job j
        JOIN dbo.agent a ON a.id_agent = j.id_agent
        LEFT JOIN dbo.agent_company ac ON ac.id_agent = a.id_agent AND ac.is_primary = 1
        LEFT JOIN dbo.company co ON co.id_company = ac.id_company
        ${memorias ? "LEFT JOIN dbo.agent_memory_setting ms ON ms.id_agent = a.id_agent" : ""}
        WHERE a.is_active = 1
          ${memorias ? "AND (ms.private_owner_email IS NULL OR LOWER(ms.private_owner_email) = @email)" : ""}
          AND (@code IS NULL OR a.code = @code)
        ORDER BY a.display_name, j.nombre;
      `),
    );
    return (r.recordset as Fila[])
      .filter((f) => agentInScope(alcance, Number(f.id_agent)))
      .map(aDto);
  } catch (e) {
    if (esAusente(e)) return null;
    throw e;
  }
}

/**
 * Publica el inventario: inserta o actualiza por clave y borra las de los
 * equipos leídos que ya no aparecen (se desinstalaron). Las de un equipo que
 * no respondió se conservan con su visto_at viejo (la pantalla lo advierte).
 */
export async function publicarProgramadas(
  p: PublicacionProgramadas,
): Promise<{ automatizaciones: number; borradas: number; sinAgente: number }> {
  const filas = p.automatizaciones.map((a) => ({
    ...a,
    cargada: a.cargada === null ? null : a.cargada ? 1 : 0,
    habilitada: a.habilitada === null ? null : a.habilitada ? 1 : 0,
    ultimaOk: a.ultimaOk === null ? null : a.ultimaOk ? 1 : 0,
    semanasJson: JSON.stringify(a.semanas),
  }));
  try {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("corte", sql.Date, p.corte)
        .input("hosts", sql.NVarChar(sql.MAX), JSON.stringify(p.hostsLeidos))
        .input("filas", sql.NVarChar(sql.MAX), JSON.stringify(filas)).query(`
          SET XACT_ABORT ON; BEGIN TRAN;
          DECLARE @j TABLE (
            clave NVARCHAR(160) PRIMARY KEY, id_agent INT NOT NULL, host NVARCHAR(40), tipo NVARCHAR(20),
            nombre NVARCHAR(200), descripcion NVARCHAR(1000), programacion NVARCHAR(200), cargada BIT,
            habilitada BIT, estado NVARCHAR(20), estado_detalle NVARCHAR(400), ultima_corrida DATETIME2(0),
            ultima_ok BIT, corridas_30 INT, ok_30 INT, corridas_90 INT, ok_90 INT,
            produccion_etiqueta NVARCHAR(120), produccion_30 INT, produccion_90 INT,
            primera_corrida DATE, semanas_json NVARCHAR(MAX));
          INSERT INTO @j
          SELECT x.clave, a.id_agent, x.host, x.tipo, x.nombre, x.descripcion, x.programacion, x.cargada,
                 x.habilitada, x.estado, x.estadoDetalle, CONVERT(DATETIME2(0), x.ultimaCorrida, 127),
                 x.ultimaOk, x.corridas30, x.ok30, x.corridas90, x.ok90, x.produccionEtiqueta,
                 x.produccion30, x.produccion90, x.primeraCorrida, x.semanasJson
          FROM OPENJSON(@filas) WITH (
                 clave NVARCHAR(160) '$.clave', code NVARCHAR(60) '$.code', host NVARCHAR(40) '$.host',
                 tipo NVARCHAR(20) '$.tipo', nombre NVARCHAR(200) '$.nombre',
                 descripcion NVARCHAR(1000) '$.descripcion', programacion NVARCHAR(200) '$.programacion',
                 cargada BIT '$.cargada', habilitada BIT '$.habilitada', estado NVARCHAR(20) '$.estado',
                 estadoDetalle NVARCHAR(400) '$.estadoDetalle', ultimaCorrida NVARCHAR(40) '$.ultimaCorrida',
                 ultimaOk BIT '$.ultimaOk', corridas30 INT '$.corridas30', ok30 INT '$.ok30',
                 corridas90 INT '$.corridas90', ok90 INT '$.ok90',
                 produccionEtiqueta NVARCHAR(120) '$.produccionEtiqueta', produccion30 INT '$.produccion30',
                 produccion90 INT '$.produccion90', primeraCorrida DATE '$.primeraCorrida',
                 semanasJson NVARCHAR(MAX) '$.semanasJson') x
          JOIN dbo.agent a ON a.code = x.code;
          DECLARE @sinAgente INT = (SELECT COUNT(*) FROM OPENJSON(@filas)) - @@ROWCOUNT;

          UPDATE t SET id_agent = j.id_agent, host = j.host, tipo = j.tipo, nombre = j.nombre,
                 descripcion = j.descripcion, programacion = j.programacion, cargada = j.cargada,
                 habilitada = j.habilitada, estado = j.estado, estado_detalle = j.estado_detalle,
                 ultima_corrida = j.ultima_corrida, ultima_ok = j.ultima_ok, corridas_30 = j.corridas_30,
                 ok_30 = j.ok_30, corridas_90 = j.corridas_90, ok_90 = j.ok_90,
                 produccion_etiqueta = j.produccion_etiqueta, produccion_30 = j.produccion_30,
                 produccion_90 = j.produccion_90, primera_corrida = j.primera_corrida,
                 semanas_json = j.semanas_json, corte = @corte, visto_at = SYSUTCDATETIME()
          FROM dbo.agent_scheduled_job t JOIN @j j ON j.clave = t.clave;
          INSERT INTO dbo.agent_scheduled_job (clave, id_agent, host, tipo, nombre, descripcion, programacion,
                 cargada, habilitada, estado, estado_detalle, ultima_corrida, ultima_ok, corridas_30, ok_30,
                 corridas_90, ok_90, produccion_etiqueta, produccion_30, produccion_90, primera_corrida,
                 semanas_json, corte, visto_at, creado_at)
          SELECT j.clave, j.id_agent, j.host, j.tipo, j.nombre, j.descripcion, j.programacion, j.cargada,
                 j.habilitada, j.estado, j.estado_detalle, j.ultima_corrida, j.ultima_ok, j.corridas_30, j.ok_30,
                 j.corridas_90, j.ok_90, j.produccion_etiqueta, j.produccion_30, j.produccion_90,
                 j.primera_corrida, j.semanas_json, @corte, SYSUTCDATETIME(), SYSUTCDATETIME()
          FROM @j j WHERE NOT EXISTS (SELECT 1 FROM dbo.agent_scheduled_job t WHERE t.clave = j.clave);
          DECLARE @n INT = (SELECT COUNT(*) FROM @j);

          DELETE t FROM dbo.agent_scheduled_job t
          WHERE t.host IN (SELECT LOWER(value) FROM OPENJSON(@hosts))
            AND NOT EXISTS (SELECT 1 FROM @j j WHERE j.clave = t.clave);
          DECLARE @borradas INT = @@ROWCOUNT;
          COMMIT TRAN;
          SELECT @n AS n, @borradas AS borradas, @sinAgente AS sin_agente;
        `),
    );
    const f = (r.recordset as Fila[])[0] ?? {};
    return {
      automatizaciones: Number(f.n ?? 0),
      borradas: Number(f.borradas ?? 0),
      sinAgente: Number(f.sin_agente ?? 0),
    };
  } catch (e) {
    if (esAusente(e)) throw new ProgramadasNoDisponible();
    throw e;
  }
}
