import "server-only";
import { sql, withMssqlPool } from "../mssqlPool";
import type { AuditScope } from "../chat/audit-access";
import {
  ORDEN_SEVERIDAD,
  type Categoria,
  type Cumplio,
  type EstadoHallazgo,
  type PublicacionAnalisis,
  type Severidad,
} from "./security-rules";

/**
 * AUDITORÍA DE AGENTES → ANÁLISIS DE SEGURIDAD DE CONVERSACIONES (Nicolás, 2026-11-05).
 * Tablas: prisma/manual/2026-11-05-analisis-seguridad-*.sql (sin modelo Prisma, igual que el
 * indicador de automatizaciones). Reglas puras y validación: ./security-rules.ts.
 *
 * Alcance: la administración ve todo; fuera de ella, hilos directos de sus agentes y grupos
 * de sus empresas (mismo criterio que la auditoría). La EVIDENCIA y la explicación son texto
 * de las conversaciones: solo salen con el permiso de conversaciones (textScope).
 */

export class AnalisisSeguridadNoDisponible extends Error {
  constructor() {
    super("El análisis de seguridad aún no está habilitado en este ambiente.");
  }
}

type Fila = Record<string, unknown>;
const esAusente = (e: unknown) => (e as { number?: number } | null)?.number === 208;
async function conTablas<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (esAusente(e)) throw new AnalisisSeguridadNoDisponible();
    throw e;
  }
}
const fechaHora = (v: unknown) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));

export interface CorridaSeguridadDto {
  id: number;
  periodo: string;
  origen: string;
  status: "pendiente" | "en_curso" | "terminado" | "fallido";
  solicitadoPor: string | null;
  solicitadoEn: string | null;
  iniciadoEn: string | null;
  terminadoEn: string | null;
  progreso: string | null;
  conversaciones: number | null;
  mensajesOperador: number | null;
  mensajesAgente: number | null;
  hallazgos: number | null;
  modelo: string | null;
  resumen: string | null;
  error: string | null;
}

function aCorrida(f: Fila | undefined): CorridaSeguridadDto | null {
  if (!f) return null;
  return {
    id: Number(f.id_run),
    periodo: String(f.periodo),
    origen: String(f.origen),
    status: String(f.status) as CorridaSeguridadDto["status"],
    solicitadoPor: txt(f.requested_by),
    solicitadoEn: fechaHora(f.requested_at),
    iniciadoEn: fechaHora(f.started_at),
    terminadoEn: fechaHora(f.finished_at),
    progreso: txt(f.progreso),
    conversaciones: num(f.conversaciones),
    mensajesOperador: num(f.mensajes_operador),
    mensajesAgente: num(f.mensajes_agente),
    hallazgos: num(f.hallazgos),
    modelo: txt(f.modelo),
    resumen: txt(f.resumen),
    error: txt(f.error_summary),
  };
}

export interface HallazgoDto {
  id: number;
  idMessage: number;
  idConversation: number;
  agente: string | null;
  persona: string | null;
  rol: "user" | "agent";
  fecha: string | null;
  categoria: Categoria;
  severidad: Severidad;
  detector: string;
  reglas: string | null;
  /** null = sin el permiso de conversaciones. */
  evidencia: string | null;
  explicacion: string | null;
  recomendacion: string | null;
  agenteCumplio: Cumplio | null;
  estado: EstadoHallazgo;
  revisadoPor: string | null;
  revisadoEn: string | null;
  nota: string | null;
}

export interface AnalisisSeguridadDto {
  periodo: string;
  /** Corrida pendiente o en curso (cualquier mes): el botón queda ocupado. */
  activa: CorridaSeguridadDto | null;
  /** Última corrida cerrada de ese mes (terminada o fallida). */
  ultima: CorridaSeguridadDto | null;
  hallazgos: HallazgoDto[];
  conTexto: boolean;
  historial: CorridaSeguridadDto[];
}

/** Filtro SQL del alcance sobre agent_security_finding (alias f). */
function filtroAlcance(scope: AuditScope, prefijo: string): { where: string; agentes: string; empresas: string } {
  if (scope.all) return { where: "1 = 1", agentes: "", empresas: "" };
  const agentes = JSON.stringify(scope.agentIds);
  const empresas = JSON.stringify(scope.companyIds);
  return {
    where: `((f.conv_kind = N'direct' AND f.id_agent IN (SELECT CAST(value AS INT) FROM OPENJSON(@${prefijo}Agentes)))
             OR (f.conv_kind = N'group' AND f.id_company IN (SELECT CAST(value AS INT) FROM OPENJSON(@${prefijo}Empresas))))`,
    agentes,
    empresas,
  };
}

export async function leerAnalisis(
  periodo: string,
  scope: AuditScope,
  textScope: AuditScope | null,
): Promise<AnalisisSeguridadDto> {
  return conTablas(async () => {
    const alcance = filtroAlcance(scope, "s");
    const texto = textScope ? filtroAlcance(textScope, "t") : null;
    const r = await withMssqlPool((pool) => {
      const req = pool.request().input("periodo", sql.Char(7), periodo);
      if (!scope.all) req.input("sAgentes", sql.NVarChar(sql.MAX), alcance.agentes).input("sEmpresas", sql.NVarChar(sql.MAX), alcance.empresas);
      if (texto && textScope && !textScope.all)
        req.input("tAgentes", sql.NVarChar(sql.MAX), texto.agentes).input("tEmpresas", sql.NVarChar(sql.MAX), texto.empresas);
      return req.query(`
        SELECT TOP 1 * FROM dbo.agent_security_run WHERE status IN (N'pendiente', N'en_curso') ORDER BY requested_at DESC;
        DECLARE @ultima INT = (SELECT TOP 1 id_run FROM dbo.agent_security_run
                               WHERE periodo = @periodo AND status IN (N'terminado', N'fallido')
                               ORDER BY ISNULL(finished_at, requested_at) DESC);
        SELECT * FROM dbo.agent_security_run WHERE id_run = @ultima;
        SELECT f.*, ${texto ? `CASE WHEN ${texto.where} THEN 1 ELSE 0 END` : "0"} AS con_texto
        FROM dbo.agent_security_finding f
        WHERE f.id_run = @ultima AND ${alcance.where}
        ORDER BY CASE f.severidad WHEN N'critica' THEN 0 WHEN N'alta' THEN 1 WHEN N'media' THEN 2 ELSE 3 END,
                 f.message_at DESC;
        SELECT TOP 12 * FROM dbo.agent_security_run ORDER BY requested_at DESC;
      `);
    });
    const sets = r.recordsets as unknown as Fila[][];
    const hallazgos: HallazgoDto[] = (sets[2] ?? []).map((f) => {
      const conTexto = Number(f.con_texto) === 1;
      return {
        id: Number(f.id_finding),
        idMessage: Number(f.id_message),
        idConversation: Number(f.id_conversation),
        agente: txt(f.agente),
        persona: txt(f.persona_email),
        rol: String(f.rol) as "user" | "agent",
        fecha: fechaHora(f.message_at),
        categoria: String(f.categoria) as Categoria,
        severidad: String(f.severidad) as Severidad,
        detector: String(f.detector),
        reglas: txt(f.reglas),
        evidencia: conTexto ? txt(f.evidencia) : null,
        explicacion: conTexto ? txt(f.explicacion) : null,
        recomendacion: conTexto ? txt(f.recomendacion) : null,
        agenteCumplio: (txt(f.agente_cumplio) as Cumplio | null) ?? null,
        estado: String(f.estado) as EstadoHallazgo,
        revisadoPor: txt(f.revisado_por),
        revisadoEn: fechaHora(f.revisado_at),
        nota: conTexto ? txt(f.nota) : null,
      };
    });
    return {
      periodo,
      activa: aCorrida(sets[0]?.[0]),
      ultima: aCorrida(sets[1]?.[0]),
      hallazgos: hallazgos.sort(
        (a, b) => ORDEN_SEVERIDAD.indexOf(a.severidad) - ORDEN_SEVERIDAD.indexOf(b.severidad),
      ),
      conTexto: textScope !== null,
      historial: (sets[3] ?? []).map((f) => aCorrida(f)!).filter(Boolean),
    };
  });
}

/** Botón «Analizar»: deja una corrida pendiente (una sola a la vez en todo el ambiente). */
export async function pedirAnalisisSeguridad(email: string, periodo: string): Promise<CorridaSeguridadDto> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("email", sql.NVarChar(200), email.trim())
        .input("periodo", sql.Char(7), periodo).query(`
        SET XACT_ABORT ON; BEGIN TRAN;
        DECLARE @id INT = (SELECT TOP 1 id_run FROM dbo.agent_security_run WITH (UPDLOCK, HOLDLOCK)
                           WHERE status IN (N'pendiente', N'en_curso') ORDER BY requested_at DESC);
        IF @id IS NULL
        BEGIN
          INSERT INTO dbo.agent_security_run (periodo, origen, status, requested_by, requested_at)
          VALUES (@periodo, N'manual', N'pendiente', @email, SYSUTCDATETIME());
          SET @id = SCOPE_IDENTITY();
        END
        COMMIT TRAN;
        SELECT * FROM dbo.agent_security_run WHERE id_run = @id;
      `),
    );
    return aCorrida((r.recordset as Fila[])[0])!;
  });
}

/** Analizador: toma la corrida pendiente más antigua (o null). Una tomada hace 3 h se da por perdida. */
export async function tomarCorridaSeguridad(): Promise<CorridaSeguridadDto | null> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool.request().query(`
        SET XACT_ABORT ON; BEGIN TRAN;
        UPDATE dbo.agent_security_run SET status = N'fallido', finished_at = SYSUTCDATETIME(),
               error_summary = N'El analizador tomó la corrida y no terminó a tiempo (3 horas).'
        WHERE status = N'en_curso' AND started_at < DATEADD(HOUR, -3, SYSUTCDATETIME());
        DECLARE @id INT = (SELECT TOP 1 id_run FROM dbo.agent_security_run WITH (UPDLOCK, READPAST)
                           WHERE status = N'pendiente' ORDER BY requested_at);
        IF @id IS NOT NULL
          UPDATE dbo.agent_security_run SET status = N'en_curso', started_at = SYSUTCDATETIME(),
                 progreso = N'Leyendo las conversaciones del mes…' WHERE id_run = @id;
        COMMIT TRAN;
        SELECT * FROM dbo.agent_security_run WHERE id_run = @id;
      `),
    );
    return aCorrida((r.recordset as Fila[])[0]);
  });
}

/** Analizador: avance visible en la pantalla («Lote 3 de 12…»). */
export async function progresoCorridaSeguridad(idRun: number, texto: string): Promise<void> {
  await conTablas(() =>
    withMssqlPool((pool) =>
      pool
        .request()
        .input("id", sql.Int, idRun)
        .input("p", sql.NVarChar(200), texto.slice(0, 200))
        .query(`UPDATE dbo.agent_security_run SET progreso = @p WHERE id_run = @id AND status = N'en_curso';`),
    ),
  );
}

export async function fallarCorridaSeguridad(idRun: number, error: string): Promise<void> {
  await conTablas(() =>
    withMssqlPool((pool) =>
      pool
        .request()
        .input("id", sql.Int, idRun)
        .input("error", sql.NVarChar(1000), (error || "Error sin detalle").slice(0, 1000)).query(`
          UPDATE dbo.agent_security_run SET status = N'fallido', finished_at = SYSUTCDATETIME(), error_summary = @error
          WHERE id_run = @id AND status IN (N'pendiente', N'en_curso');
        `),
    ),
  );
}

/**
 * Publica el resultado de una corrida. Los datos de la conversación (tipo, agente, empresa,
 * persona) se toman de la BASE, no del analizador. Si el mismo mensaje y categoría ya se había
 * revisado en una corrida anterior del mes, se conserva la revisión (estado, nota, quién).
 */
export async function publicarAnalisisSeguridad(p: PublicacionAnalisis): Promise<{ hallazgos: number }> {
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("id", sql.Int, p.idRun)
        .input("periodo", sql.Char(7), p.periodo)
        .input("conv", sql.Int, p.conversaciones)
        .input("mo", sql.Int, p.mensajesOperador)
        .input("ma", sql.Int, p.mensajesAgente)
        .input("modelo", sql.NVarChar(60), p.modelo)
        .input("resumen", sql.NVarChar(2000), p.resumen)
        .input("h", sql.NVarChar(sql.MAX), JSON.stringify(p.hallazgos)).query(`
          SET XACT_ABORT ON; BEGIN TRAN;
          IF NOT EXISTS (SELECT 1 FROM dbo.agent_security_run WHERE id_run = @id AND status = N'en_curso')
            THROW 51610, N'La corrida no está en curso.', 1;
          DELETE FROM dbo.agent_security_finding WHERE id_run = @id;
          INSERT INTO dbo.agent_security_finding (id_run, periodo, id_message, id_conversation, conv_kind, id_agent,
                 id_company, agente, persona_email, rol, message_at, categoria, severidad, detector, reglas, evidencia,
                 explicacion, recomendacion, agente_cumplio, estado, revisado_por, revisado_at, nota)
          SELECT @id, @periodo, j.idMessage, c.id, c.kind, c.id_agent, c.id_company, a.display_name,
                 CASE WHEN j.rol = N'user' THEN au.email ELSE owner.email END,
                 j.rol, j.messageAt, j.categoria, j.severidad, j.detector, j.reglas, j.evidencia, j.explicacion,
                 j.recomendacion, j.agenteCumplio,
                 ISNULL(prev.estado, N'nuevo'), prev.revisado_por, prev.revisado_at, prev.nota
          FROM OPENJSON(@h) WITH (
                 idMessage INT '$.idMessage', idConversation INT '$.idConversation', rol NVARCHAR(10) '$.rol',
                 messageAt DATETIME2 '$.messageAt', categoria NVARCHAR(30) '$.categoria', severidad NVARCHAR(10) '$.severidad',
                 detector NVARCHAR(20) '$.detector', reglas NVARCHAR(300) '$.reglas', evidencia NVARCHAR(800) '$.evidencia',
                 explicacion NVARCHAR(1200) '$.explicacion', recomendacion NVARCHAR(800) '$.recomendacion',
                 agenteCumplio NVARCHAR(10) '$.agenteCumplio') j
          JOIN dbo.chat_message m ON m.id = j.idMessage AND m.id_conversation = j.idConversation
          JOIN dbo.chat_conversation c ON c.id = m.id_conversation
          LEFT JOIN dbo.agent a ON a.id_agent = c.id_agent
          LEFT JOIN dbo.[user] au ON au.id = m.id_user_author
          LEFT JOIN dbo.[user] owner ON owner.id = c.id_user
          OUTER APPLY (SELECT TOP 1 pf.estado, pf.revisado_por, pf.revisado_at, pf.nota
                       FROM dbo.agent_security_finding pf
                       WHERE pf.periodo = @periodo AND pf.id_message = j.idMessage AND pf.categoria = j.categoria
                         AND pf.id_run <> @id AND pf.estado <> N'nuevo'
                       ORDER BY pf.revisado_at DESC) prev;
          DECLARE @n INT = @@ROWCOUNT;
          UPDATE dbo.agent_security_run SET status = N'terminado', finished_at = SYSUTCDATETIME(), progreso = NULL,
                 conversaciones = @conv, mensajes_operador = @mo, mensajes_agente = @ma, hallazgos = @n,
                 modelo = @modelo, resumen = @resumen, error_summary = NULL
          WHERE id_run = @id;
          COMMIT TRAN;
          SELECT @n AS hallazgos;
        `),
    );
    return { hallazgos: Number((r.recordset as Fila[])[0]?.hallazgos ?? 0) };
  });
}

/** Revisión humana de un hallazgo (dentro del alcance de quien revisa). */
export async function revisarHallazgo(
  id: number,
  estado: EstadoHallazgo,
  nota: string | null,
  email: string,
  scope: AuditScope,
): Promise<boolean> {
  return conTablas(async () => {
    const alcance = filtroAlcance(scope, "s");
    const r = await withMssqlPool((pool) => {
      const req = pool
        .request()
        .input("id", sql.Int, id)
        .input("estado", sql.NVarChar(20), estado)
        .input("nota", sql.NVarChar(1000), nota)
        .input("email", sql.NVarChar(200), email);
      if (!scope.all) req.input("sAgentes", sql.NVarChar(sql.MAX), alcance.agentes).input("sEmpresas", sql.NVarChar(sql.MAX), alcance.empresas);
      return req.query(`
        UPDATE f SET estado = @estado, nota = @nota, revisado_por = @email, revisado_at = SYSUTCDATETIME()
        FROM dbo.agent_security_finding f WHERE f.id_finding = @id AND ${alcance.where};
        SELECT @@ROWCOUNT AS n;
      `);
    });
    return Number((r.recordset as Fila[])[0]?.n ?? 0) > 0;
  });
}
