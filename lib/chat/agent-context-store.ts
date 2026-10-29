import 'server-only';
import { sql, withMssqlPool } from '../mssqlPool';
import { prisma } from '../prisma';
import {
  COMANDO_LIMPIAR,
  ORDEN_EN_CURSO_VENCE_MS,
  ORDEN_PENDIENTE_VENCE_MS,
  SESION_PRINCIPAL,
  esEstadoOrden,
  esRuntime,
  estaTrabajando,
  textoEstadoOrden,
  transicionValida,
  type ContextoAgenteDto,
  type EstadoOrden,
  type OrdenDto,
  type SesionContextoInput,
} from './agent-context';

/**
 * Lectura/escritura de dbo.chat_agent_context y dbo.chat_agent_command
 * (prisma/manual/2026-10-29-chat-agent-contexto-*.sql). Reglas puras en ./agent-context.ts.
 *
 * Sin modelo Prisma, a propósito (mismo patrón que chat_agent_metrics, #516): el pase no
 * cambia schema.prisma ni exige `prisma generate`, y si las tablas aún no existen el chat
 * sigue funcionando — la lectura devuelve null y las escrituras responden 503.
 */

/** Las tablas todavía no existen en esta base (el SQL del pase no se ha corrido). */
export class ContextoNoDisponible extends Error {
  constructor() {
    super('La medición de contexto aún no está habilitada en este ambiente.');
  }
}

/** Ya hay una orden pendiente o en curso para ese agente. */
export class OrdenActiva extends Error {
  constructor(public readonly orden: OrdenDto) {
    super('Ya hay una orden de limpiar contexto en curso para este agente.');
  }
}

/** Transición de estado no permitida (p. ej. reportar dos veces el final). */
export class TransicionInvalida extends Error {}

function esTablaAusente(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { number?: number }).number === 208;
}

/** Error 2601/2627: choca con el índice único de «una orden activa por agente». */
function esDuplicado(error: unknown): boolean {
  const n = (error as { number?: number } | null)?.number;
  return n === 2601 || n === 2627;
}

async function conTablas<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (esTablaAusente(error)) throw new ContextoNoDisponible();
    throw error;
  }
}

type Fila = Record<string, unknown>;

function iso(v: unknown): string | null {
  return v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null;
}
function numONulo(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function filaAContexto(f: Fila): ContextoAgenteDto {
  const runtime = esRuntime(f.runtime) ? f.runtime : 'claude-code';
  const sessionKey = String(f.session_key ?? SESION_PRINCIPAL);
  return {
    sessionKey,
    runtime,
    alcance: sessionKey === SESION_PRINCIPAL ? 'agente' : 'conversacion',
    sessionId: (f.session_id as string | null) ?? null,
    model: (f.model as string | null) ?? null,
    tokens: numONulo(f.context_tokens),
    window: numONulo(f.context_window),
    percent: numONulo(f.context_pct),
    measuredAt: iso(f.measured_at) ?? new Date(0).toISOString(),
  };
}

function filaAOrden(f: Fila): OrdenDto {
  return {
    id: Number(f.id_command),
    command: String(f.command),
    sessionKey: String(f.session_key),
    runtime: esRuntime(f.runtime) ? f.runtime : 'claude-code',
    idConversation: numONulo(f.id_conversation),
    status: esEstadoOrden(f.status) ? f.status : 'error',
    requestedBy: String(f.requested_by ?? ''),
    requestedAt: iso(f.requested_at) ?? new Date(0).toISOString(),
    takenAt: iso(f.taken_at),
    finishedAt: iso(f.finished_at),
    result: (f.result as string | null) ?? null,
  };
}

/* ───────────────────────────── Contexto ───────────────────────────── */

/**
 * Guarda la foto de contexto de cada sesión del agente. Una medición más vieja
 * que la guardada no la pisa. Devuelve cuántas quedaron guardadas.
 */
export async function guardarContextos(idAgent: number, sesiones: SesionContextoInput[]): Promise<number> {
  const ahora = new Date();
  return conTablas(() =>
    withMssqlPool(async (pool) => {
      let guardadas = 0;
      for (const s of sesiones) {
        const r = await pool
          .request()
          .input('id_agent', sql.Int, idAgent)
          .input('session_key', sql.NVarChar(160), s.sessionKey)
          .input('runtime', sql.NVarChar(20), s.runtime)
          .input('id_conversation', sql.Int, s.idConversation)
          .input('session_id', sql.NVarChar(120), s.sessionId)
          .input('model', sql.NVarChar(120), s.model)
          .input('context_tokens', sql.Int, s.tokens)
          .input('context_window', sql.Int, s.window)
          .input('context_pct', sql.Decimal(5, 2), s.percent)
          .input('measured_at', sql.DateTime2(0), s.measuredAt)
          .input('updated_at', sql.DateTime2(0), ahora).query(`
            DECLARE @n INT;
            UPDATE dbo.chat_agent_context WITH (UPDLOCK, SERIALIZABLE) SET
              runtime = @runtime, id_conversation = @id_conversation, session_id = @session_id, model = @model,
              context_tokens = @context_tokens, context_window = @context_window, context_pct = @context_pct,
              measured_at = @measured_at, updated_at = @updated_at
            WHERE id_agent = @id_agent AND session_key = @session_key AND measured_at <= @measured_at;
            SET @n = @@ROWCOUNT;
            IF @n = 0 AND NOT EXISTS (SELECT 1 FROM dbo.chat_agent_context WITH (UPDLOCK, SERIALIZABLE)
                                      WHERE id_agent = @id_agent AND session_key = @session_key)
            BEGIN
              INSERT INTO dbo.chat_agent_context (
                id_agent, session_key, runtime, id_conversation, session_id, model,
                context_tokens, context_window, context_pct, measured_at, updated_at
              ) VALUES (
                @id_agent, @session_key, @runtime, @id_conversation, @session_id, @model,
                @context_tokens, @context_window, @context_pct, @measured_at, @updated_at
              );
              SET @n = 1;
            END;
            SELECT @n AS guardada;
          `);
        // 0 = había una medición más nueva y no se pisó.
        if (Number((r.recordset?.[0] as Fila | undefined)?.guardada ?? 0) > 0) guardadas++;
      }
      return guardadas;
    })
  );
}

/**
 * Contexto que corresponde al hilo que se está mirando: la sesión de ESA
 * conversación (openclaw) si existe; si no, la sesión única del bot. Null si el
 * agente no publica contexto o la tabla no existe. NUNCA lanza.
 */
export async function leerContexto(idAgent: number, idConversation: number | null): Promise<ContextoAgenteDto | null> {
  try {
    const r = await withMssqlPool((pool) =>
      pool
        .request()
        .input('id_agent', sql.Int, idAgent)
        .input('id_conversation', sql.Int, idConversation)
        .input('principal', sql.NVarChar(160), SESION_PRINCIPAL).query(`
          SELECT TOP 1 * FROM dbo.chat_agent_context
          WHERE id_agent = @id_agent
            AND ((@id_conversation IS NOT NULL AND id_conversation = @id_conversation) OR session_key = @principal)
          ORDER BY CASE WHEN session_key = @principal THEN 1 ELSE 0 END, measured_at DESC
        `)
    );
    const f = r.recordset?.[0] as Fila | undefined;
    return f ? filaAContexto(f) : null;
  } catch (error) {
    if (!esTablaAusente(error)) console.error('[chat/agent-context] no se pudo leer el contexto:', error);
    return null;
  }
}

/** ¿El indicador del agente dice «trabajando» en alguna conversación (reciente)? */
export async function agenteOcupado(idAgent: number): Promise<boolean> {
  const filas = await prisma.chatAgentStatus.findMany({
    where: { id_agent: idAgent, NOT: { state: 'idle' } },
    select: { state: true, updated_at: true },
  });
  return estaTrabajando(filas.map((f) => ({ state: f.state, updatedAt: f.updated_at })));
}

/* ───────────────────────────── Órdenes ───────────────────────────── */

/** Da por vencidas las órdenes que nadie tomó o que nadie cerró a tiempo. */
const SQL_VENCER = `
  UPDATE dbo.chat_agent_command
     SET status = N'vencida', finished_at = @ahora,
         result = CASE WHEN status = N'en_curso' THEN N'El ejecutor no reportó el resultado a tiempo.' ELSE result END
   WHERE id_agent = @id_agent
     AND ((status = N'pendiente' AND requested_at < @vence_pendiente)
       OR (status = N'en_curso' AND taken_at < @vence_en_curso));
`;

function entradasVencer(req: sql.Request, idAgent: number, ahora: Date) {
  return req
    .input('id_agent', sql.Int, idAgent)
    .input('ahora', sql.DateTime2(0), ahora)
    .input('vence_pendiente', sql.DateTime2(0), new Date(ahora.getTime() - ORDEN_PENDIENTE_VENCE_MS))
    .input('vence_en_curso', sql.DateTime2(0), new Date(ahora.getTime() - ORDEN_EN_CURSO_VENCE_MS));
}

/** Última orden del agente en las últimas 24 h (para el widget), o null. NUNCA lanza. */
export async function ultimaOrden(idAgent: number): Promise<OrdenDto | null> {
  try {
    const ahora = new Date();
    const r = await withMssqlPool((pool) =>
      entradasVencer(pool.request(), idAgent, ahora)
        .input('desde', sql.DateTime2(0), new Date(ahora.getTime() - 86_400_000))
        .query(`${SQL_VENCER}
          SELECT TOP 1 * FROM dbo.chat_agent_command
          WHERE id_agent = @id_agent AND requested_at >= @desde
          ORDER BY id_command DESC;`)
    );
    const f = r.recordset?.[0] as Fila | undefined;
    return f ? filaAOrden(f) : null;
  } catch (error) {
    if (!esTablaAusente(error)) console.error('[chat/agent-context] no se pudo leer la última orden:', error);
    return null;
  }
}

export interface NuevaOrden {
  idAgent: number;
  contexto: ContextoAgenteDto;
  idConversation: number | null;
  requestedBy: string;
  ip: string | null;
  userAgent: string | null;
}

/** Registra la orden «limpiar contexto». Lanza OrdenActiva si ya hay una pendiente o en curso. */
export async function crearOrdenLimpiar(n: NuevaOrden): Promise<OrdenDto> {
  const ahora = new Date();
  const orden = await conTablas(() =>
    withMssqlPool(async (pool) => {
      const tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const r = await entradasVencer(new sql.Request(tx), n.idAgent, ahora).query(`${SQL_VENCER}
          SELECT TOP 1 * FROM dbo.chat_agent_command WITH (UPDLOCK, HOLDLOCK)
          WHERE id_agent = @id_agent AND status IN (N'pendiente', N'en_curso')
          ORDER BY id_command DESC;`);
        const activa = r.recordset?.[0] as Fila | undefined;
        if (activa) {
          await tx.rollback();
          throw new OrdenActiva(filaAOrden(activa));
        }
        const ins = await new sql.Request(tx)
          .input('id_agent', sql.Int, n.idAgent)
          .input('command', sql.NVarChar(30), COMANDO_LIMPIAR)
          .input('session_key', sql.NVarChar(160), n.contexto.sessionKey)
          .input('runtime', sql.NVarChar(20), n.contexto.runtime)
          .input('id_conversation', sql.Int, n.idConversation)
          .input('requested_by', sql.NVarChar(255), n.requestedBy.slice(0, 255))
          .input('requested_ip', sql.NVarChar(64), n.ip?.slice(0, 64) ?? null)
          .input('requested_ua', sql.NVarChar(300), n.userAgent?.slice(0, 300) ?? null)
          .input('requested_at', sql.DateTime2(0), ahora).query(`
            INSERT INTO dbo.chat_agent_command (
              id_agent, command, session_key, runtime, id_conversation, status,
              requested_by, requested_ip, requested_ua, requested_at
            ) OUTPUT INSERTED.*
            VALUES (
              @id_agent, @command, @session_key, @runtime, @id_conversation, N'pendiente',
              @requested_by, @requested_ip, @requested_ua, @requested_at
            );`);
        await tx.commit();
        return filaAOrden(ins.recordset[0] as Fila);
      } catch (error) {
        if (error instanceof OrdenActiva) throw error;
        try {
          await tx.rollback();
        } catch {
          /* ya revertida */
        }
        if (esDuplicado(error)) {
          // Dos administradores a la vez: ganó el otro.
          const otra = await ultimaOrden(n.idAgent);
          if (otra) throw new OrdenActiva(otra);
        }
        throw error;
      }
    })
  );
  await anotarEnHojaDeVida(n.idAgent, orden, 'pedido', n.requestedBy, n.contexto);
  return orden;
}

/** Órdenes pendientes del agente (para el ejecutor), más viejas primero. */
export async function ordenesPendientes(idAgent: number): Promise<OrdenDto[]> {
  const ahora = new Date();
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      entradasVencer(pool.request(), idAgent, ahora).query(`${SQL_VENCER}
        SELECT TOP 10 * FROM dbo.chat_agent_command
        WHERE id_agent = @id_agent AND status = N'pendiente'
        ORDER BY id_command ASC;`)
    );
    return (r.recordset as Fila[]).map(filaAOrden);
  });
}

/**
 * El ejecutor reporta: 'en_curso' (la tomó) o un final ('ok' | 'ocupado' | 'error').
 * Solo sobre órdenes de SU agente (la llave lo decide). Devuelve la orden
 * actualizada, null si no existe (para ese agente), o lanza TransicionInvalida.
 */
export async function reportarOrden(
  idAgent: number,
  idCommand: number,
  estado: EstadoOrden,
  detalle: string | null,
  ejecutor: string | null
): Promise<OrdenDto | null> {
  const ahora = new Date();
  const orden = await conTablas(() =>
    withMssqlPool(async (pool) => {
      const tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const r = await entradasVencer(new sql.Request(tx), idAgent, ahora)
          .input('id_command', sql.Int, idCommand)
          .query(`${SQL_VENCER}
            SELECT * FROM dbo.chat_agent_command WITH (UPDLOCK, HOLDLOCK)
            WHERE id_command = @id_command AND id_agent = @id_agent;`);
        const f = r.recordset?.[0] as Fila | undefined;
        if (!f) {
          await tx.rollback();
          return null;
        }
        const actual = filaAOrden(f);
        if (!transicionValida(actual.status, estado)) {
          await tx.rollback();
          throw new TransicionInvalida(`La orden está «${actual.status}»; no puede pasar a «${estado}».`);
        }
        const u = await new sql.Request(tx)
          .input('id_command', sql.Int, idCommand)
          .input('status', sql.NVarChar(16), estado)
          .input('result', sql.NVarChar(1000), detalle ? detalle.slice(0, 1000) : null)
          .input('executor', sql.NVarChar(120), ejecutor ? ejecutor.slice(0, 120) : null)
          .input('ahora', sql.DateTime2(0), ahora).query(`
            UPDATE dbo.chat_agent_command SET
              status = @status,
              taken_at = CASE WHEN @status = N'en_curso' THEN @ahora ELSE COALESCE(taken_at, @ahora) END,
              finished_at = CASE WHEN @status = N'en_curso' THEN NULL ELSE @ahora END,
              result = COALESCE(@result, result),
              executor = COALESCE(@executor, executor)
            OUTPUT INSERTED.*
            WHERE id_command = @id_command;`);
        await tx.commit();
        return filaAOrden(u.recordset[0] as Fila);
      } catch (error) {
        if (!(error instanceof TransicionInvalida)) {
          try {
            await tx.rollback();
          } catch {
            /* ya revertida */
          }
        }
        throw error;
      }
    })
  );
  if (orden && estado !== 'en_curso') await anotarEnHojaDeVida(idAgent, orden, 'resultado', null, null);
  return orden;
}

/* ───────────────────── Auditoría (hoja de vida del agente) ───────────────────── */

/**
 * Deja la orden en la línea de tiempo de la hoja de vida del agente (Auditoría
 * de agentes): quién la pidió y cuándo, y luego cómo terminó. La fila de
 * chat_agent_command ya es el registro completo (correo, IP, navegador, horas);
 * esto es la vista para auditoría. Nunca hace fallar la orden.
 */
async function anotarEnHojaDeVida(
  idAgent: number,
  orden: OrdenDto,
  momento: 'pedido' | 'resultado',
  email: string | null,
  contexto: ContextoAgenteDto | null
): Promise<void> {
  try {
    const alcance =
      orden.sessionKey === SESION_PRINCIPAL ? 'sesión completa del agente' : `sesión de la conversación ${orden.idConversation ?? '—'}`;
    const pct = contexto?.percent !== null && contexto?.percent !== undefined ? ` (contexto al ${Math.round(contexto.percent)} %)` : '';
    const entrada =
      momento === 'pedido'
        ? {
            title: `Orden de limpiar contexto${pct}`,
            detail: `Pedida por ${email ?? orden.requestedBy}. Alcance: ${alcance}. Orden #${orden.id}.`,
            created_by: email ?? orden.requestedBy,
          }
        : {
            title: `Limpiar contexto: ${orden.status === 'ok' ? 'hecho' : orden.status}`,
            detail: `${textoEstadoOrden(orden.status)}${orden.result ? ` ${orden.result}` : ''} Orden #${orden.id}, pedida por ${orden.requestedBy}.`,
            created_by: null,
          };
    await prisma.agentCvEntry.create({
      data: {
        id_agent: idAgent,
        occurred_at: new Date(),
        kind: 'contexto',
        title: entrada.title.slice(0, 300),
        detail: entrada.detail.slice(0, 2000),
        source_ref: `contexto:${orden.id}:${momento}`,
        created_by: entrada.created_by,
      },
    });
  } catch (error) {
    console.error('[chat/agent-context] no se pudo anotar la orden en la hoja de vida:', error);
  }
}
