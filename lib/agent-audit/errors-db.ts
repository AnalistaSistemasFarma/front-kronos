import 'server-only';
import { sql, withMssqlPool } from '../mssqlPool';
import { agentInScope, type AuditScope } from '../chat/audit-access';
import {
  debeNotificar,
  type Ambiente,
  type EstadoError,
  type EventoError,
  type PublicacionErrores,
  type Severidad,
  type TipoError,
} from './errors';

/**
 * AUDITORÍA DE AGENTES → ERRORES DE IA: acceso a la base.
 * Tablas: prisma/manual/2026-11-03-errores-ia-*.sql (sin modelo Prisma).
 * Sin las tablas todo lanza ErroresNoDisponibles (la pantalla dice «aún no
 * habilitado» y el recolector recibe 503).
 *
 * Agentes personales (agent_memory_setting.private_owner_email): sus errores
 * solo los ve su dueño, igual que el indicador y las memorias.
 */

export class ErroresNoDisponibles extends Error {
  constructor() {
    super('El panel de errores de IA aún no está habilitado en este ambiente.');
  }
}

type Fila = Record<string, unknown>;
const esAusente = (e: unknown) => (e as { number?: number } | null)?.number === 208;
async function conTablas<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (esAusente(e)) throw new ErroresNoDisponibles();
    throw e;
  }
}
const fechaHora = (v: unknown) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null);
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export interface ErrorIaDto {
  id: number;
  huella: string;
  agente: string;
  agenteNombre: string | null;
  idAgent: number | null;
  empresa: string | null;
  host: string | null;
  tipo: TipoError;
  severidad: Severidad;
  ambiente: Ambiente;
  titulo: string;
  detalle: string | null;
  primeraVez: string | null;
  ultimaVez: string | null;
  ocurrencias: number;
  estado: EstadoError;
  estadoPor: string | null;
  estadoEn: string | null;
  notificadoEn: string | null;
  idConversacion: number | null;
  idMensaje: number | null;
  reintentoPor: string | null;
  reintentoEn: string | null;
}

export interface EventoIaDto {
  ocurrioEn: string | null;
  idConversacion: number | null;
  idMensaje: number | null;
  muestra: string | null;
}

export interface ErroresDto {
  errores: ErrorIaDto[];
  ambienteServidor: Ambiente;
  ultimaRecepcion: string | null;
}

/** El ambiente de ESTE servidor sale de la base: KRONOSDB = prod. */
async function ambienteDe(pool: sql.ConnectionPool): Promise<Ambiente> {
  const r = await pool.request().query('SELECT DB_NAME() AS base');
  return String(r.recordset[0]?.base ?? '') === 'KRONOSDB' ? 'prod' : 'pruebas';
}

/**
 * La reja de agentes personales vive en agent_memory_setting (pase de
 * Memorias, 2026-10-29). Si ese pase no está en el ambiente, no hay agentes
 * personales: se consulta sin la tabla en lugar de fallar.
 */
let conMemorias: boolean | null = null;
async function selectIssue(pool: sql.ConnectionPool): Promise<string> {
  if (conMemorias === null) {
    const r = await pool.request().query(`SELECT OBJECT_ID(N'dbo.agent_memory_setting', N'U') AS t`);
    conMemorias = r.recordset[0]?.t !== null && r.recordset[0]?.t !== undefined;
  }
  return `
  SELECT i.*, a.display_name, LTRIM(RTRIM(co.company)) AS empresa,
         ${conMemorias ? 'ms.private_owner_email' : 'CAST(NULL AS NVARCHAR(200)) AS private_owner_email'}
  FROM dbo.agent_error_issue i
  LEFT JOIN dbo.agent a ON a.id_agent = i.id_agent
  LEFT JOIN dbo.agent_company ac ON ac.id_agent = a.id_agent AND ac.is_primary = 1
  LEFT JOIN dbo.company co ON co.id_company = ac.id_company
  ${conMemorias ? 'LEFT JOIN dbo.agent_memory_setting ms ON ms.id_agent = a.id_agent' : ''}`;
}

function aDto(f: Fila): ErrorIaDto {
  return {
    id: Number(f.id_issue),
    huella: String(f.huella),
    agente: String(f.agent_code),
    agenteNombre: txt(f.display_name),
    idAgent: num(f.id_agent),
    empresa: txt(f.empresa),
    host: txt(f.host),
    tipo: String(f.tipo) as TipoError,
    severidad: String(f.severidad) as Severidad,
    ambiente: String(f.ambiente) as Ambiente,
    titulo: String(f.titulo),
    detalle: txt(f.detalle),
    primeraVez: fechaHora(f.first_seen),
    ultimaVez: fechaHora(f.last_seen),
    ocurrencias: Number(f.ocurrencias ?? 0),
    estado: String(f.estado) as EstadoError,
    estadoPor: txt(f.estado_por),
    estadoEn: fechaHora(f.estado_at),
    notificadoEn: fechaHora(f.notified_at),
    idConversacion: num(f.id_conversation),
    idMensaje: num(f.id_message),
    reintentoPor: txt(f.reintento_por),
    reintentoEn: fechaHora(f.reintento_at),
  };
}

/** ¿Lo puede ver este usuario? Alcance de la auditoría + reja de agentes personales. */
function visible(f: Fila, email: string, alcance: AuditScope): boolean {
  const dueno = txt(f.private_owner_email)?.toLowerCase();
  if (dueno && dueno !== email.trim().toLowerCase()) return false;
  if (alcance.all) return true;
  const id = num(f.id_agent);
  return id !== null && agentInScope(alcance, id);
}

/** Errores agrupados (los 1.000 más recientes; abiertos primero en la pantalla). */
export async function leerErrores(email: string, alcance: AuditScope): Promise<ErroresDto> {
  return conTablas(() =>
    withMssqlPool(async (pool) => {
      const r = await pool.request().query(`
        ${await selectIssue(pool)}
        WHERE i.id_issue IN (SELECT TOP 1000 id_issue FROM dbo.agent_error_issue ORDER BY last_seen DESC);
        SELECT MAX(recibido_at) AS ultima FROM dbo.agent_error_event;`);
      const sets = r.recordsets as unknown as Fila[][];
      const errores = (sets[0] ?? [])
        .filter((f) => visible(f, email, alcance))
        .map(aDto)
        .sort((a, b) => (b.ultimaVez ?? '').localeCompare(a.ultimaVez ?? ''));
      return {
        errores,
        ambienteServidor: await ambienteDe(pool),
        ultimaRecepcion: fechaHora(sets[1]?.[0]?.ultima),
      };
    }),
  );
}

async function leerIssue(pool: sql.ConnectionPool, idIssue: number): Promise<Fila | undefined> {
  const r = await pool.request().input('id', sql.Int, idIssue).query(`${await selectIssue(pool)} WHERE i.id_issue = @id`);
  return r.recordset[0] as Fila | undefined;
}

/** Últimas 50 ocurrencias de UN error (null si no existe o no lo puede ver). */
export async function leerEventos(
  idIssue: number,
  email: string,
  alcance: AuditScope,
): Promise<EventoIaDto[] | null> {
  return conTablas(() =>
    withMssqlPool(async (pool) => {
      const f = await leerIssue(pool, idIssue);
      if (!f || !visible(f, email, alcance)) return null;
      const r = await pool.request().input('id', sql.Int, idIssue).query(`
        SELECT TOP 50 ocurrio_at, id_conversation, id_message, muestra
        FROM dbo.agent_error_event WHERE id_issue = @id ORDER BY ocurrio_at DESC, id_event DESC`);
      return (r.recordset as Fila[]).map((e) => ({
        ocurrioEn: fechaHora(e.ocurrio_at),
        idConversacion: num(e.id_conversation),
        idMensaje: num(e.id_message),
        muestra: txt(e.muestra),
      }));
    }),
  );
}

/** Cambia el estado (abierto | resuelto | silenciado). false si no existe o no lo puede ver. */
export async function cambiarEstado(
  idIssue: number,
  estado: EstadoError,
  email: string,
  alcance: AuditScope,
): Promise<ErrorIaDto | null> {
  return conTablas(() =>
    withMssqlPool(async (pool) => {
      const f = await leerIssue(pool, idIssue);
      if (!f || !visible(f, email, alcance)) return null;
      await pool
        .request()
        .input('id', sql.Int, idIssue)
        .input('estado', sql.NVarChar(12), estado)
        .input('por', sql.NVarChar(200), email.trim().toLowerCase())
        .query(`UPDATE dbo.agent_error_issue
                SET estado = @estado, estado_por = @por, estado_at = SYSUTCDATETIME()
                WHERE id_issue = @id`);
      const g = await leerIssue(pool, idIssue);
      return g ? aDto(g) : null;
    }),
  );
}

export interface ResultadoPublicacion {
  eventos: number;
  eventosNuevos: number;
  erroresNuevos: number;
  notificar: {
    huella: string;
    agente: string;
    tipo: TipoError;
    severidad: Severidad;
    ambiente: Ambiente;
    titulo: string;
    ocurrencias: number;
    nuevo: boolean;
    idConversacion: number | null;
  }[];
}

/**
 * Publica un lote del recolector: crea o actualiza cada error por huella y
 * guarda las ocurrencias que no existían (la clave única descarta las
 * repetidas). Devuelve los errores que hay que avisar si la notificación está
 * activa; el aviso se marca como hecho solo cuando el recolector lo acusa
 * (acusarNotificados), para que un aviso que no salió se reintente.
 */
export async function publicarErrores(
  pub: PublicacionErrores,
  opciones: { notificar: boolean; horas: number; ahora?: Date },
): Promise<ResultadoPublicacion> {
  const ahora = opciones.ahora ?? new Date();
  const grupos = new Map<string, EventoError[]>();
  for (const e of pub.eventos) {
    const g = grupos.get(e.huella) ?? [];
    g.push(e);
    grupos.set(e.huella, g);
  }
  return conTablas(() =>
    withMssqlPool(async (pool) => {
      const codigos = [...new Set(pub.eventos.map((e) => e.agente))];
      const ids = new Map<string, number>();
      if (codigos.length) {
        const rq = pool.request();
        const ph = codigos.map((c, i) => {
          rq.input(`c${i}`, sql.NVarChar(60), c);
          return `@c${i}`;
        });
        const r = await rq.query(`SELECT id_agent, LOWER(code) AS code FROM dbo.agent WHERE LOWER(code) IN (${ph.join(',')})`);
        for (const f of r.recordset as Fila[]) ids.set(String(f.code), Number(f.id_agent));
      }

      const res: ResultadoPublicacion = { eventos: pub.eventos.length, eventosNuevos: 0, erroresNuevos: 0, notificar: [] };
      for (const [huella, evs] of grupos) {
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
          const base = evs[evs.length - 1];
          const r0 = await new sql.Request(tx)
            .input('h', sql.Char(64), huella)
            .query(`SELECT id_issue, estado, notified_at FROM dbo.agent_error_issue WITH (UPDLOCK, HOLDLOCK) WHERE huella = @h`);
          let fila = r0.recordset[0] as Fila | undefined;
          const nueva = !fila;
          if (!fila) {
            const primero = evs.reduce((a, b) => (a.ocurrioEn < b.ocurrioEn ? a : b)).ocurrioEn;
            const ins = await new sql.Request(tx)
              .input('h', sql.Char(64), huella)
              .input('code', sql.NVarChar(60), base.agente)
              .input('idAgent', sql.Int, ids.get(base.agente) ?? null)
              .input('host', sql.NVarChar(60), base.host)
              .input('tipo', sql.NVarChar(40), base.tipo)
              .input('sev', sql.NVarChar(10), base.severidad)
              .input('amb', sql.NVarChar(10), base.ambiente)
              .input('titulo', sql.NVarChar(300), base.titulo)
              .input('t', sql.DateTime2(0), primero).query(`
                INSERT INTO dbo.agent_error_issue
                  (huella, agent_code, id_agent, host, tipo, severidad, ambiente, titulo, first_seen, last_seen)
                OUTPUT INSERTED.id_issue, INSERTED.estado, INSERTED.notified_at
                VALUES (@h, @code, @idAgent, @host, @tipo, @sev, @amb, @titulo, @t, @t)`);
            fila = ins.recordset[0] as Fila;
            res.erroresNuevos++;
          }
          const idIssue = Number(fila.id_issue);
          let insertados = 0;
          let ultimo: EventoError | null = null;
          let ultimoConIds: EventoError | null = null;
          for (const e of evs) {
            const r = await new sql.Request(tx)
              .input('id', sql.Int, idIssue)
              .input('k', sql.Char(64), e.eventoClave)
              .input('t', sql.DateTime2(0), e.ocurrioEn)
              .input('conv', sql.Int, e.idConversacion)
              .input('msg', sql.Int, e.idMensaje)
              .input('muestra', sql.NVarChar(1000), e.detalle ?? e.titulo).query(`
                IF NOT EXISTS (SELECT 1 FROM dbo.agent_error_event WHERE evento_clave = @k)
                  INSERT INTO dbo.agent_error_event (id_issue, evento_clave, ocurrio_at, id_conversation, id_message, muestra)
                  VALUES (@id, @k, @t, @conv, @msg, @muestra);
                SELECT @@ROWCOUNT AS n;`);
            if (Number(r.recordset[0]?.n ?? 0) > 0) {
              insertados++;
              if (!ultimo || e.ocurrioEn >= ultimo.ocurrioEn) ultimo = e;
              if ((e.idConversacion || e.idMensaje) && (!ultimoConIds || e.ocurrioEn >= ultimoConIds.ocurrioEn)) ultimoConIds = e;
            }
          }
          const estadoAntes = String(fila.estado) as EstadoError;
          const reabierta = insertados > 0 && estadoAntes === 'resuelto';
          let ocurrencias = 0;
          if (insertados > 0 && ultimo) {
            const u = await new sql.Request(tx)
              .input('id', sql.Int, idIssue)
              .input('n', sql.Int, insertados)
              .input('t', sql.DateTime2(0), ultimo.ocurrioEn)
              .input('detalle', sql.NVarChar(2000), ultimo.detalle ?? ultimo.titulo)
              .input('host', sql.NVarChar(60), ultimo.host)
              .input('conv', sql.Int, ultimoConIds?.idConversacion ?? null)
              .input('msg', sql.Int, ultimoConIds?.idMensaje ?? null)
              .input('hayIds', sql.Bit, ultimoConIds ? 1 : 0).query(`
                UPDATE dbo.agent_error_issue SET
                  ocurrencias = ocurrencias + @n,
                  last_seen = CASE WHEN @t > last_seen THEN @t ELSE last_seen END,
                  first_seen = (SELECT MIN(ocurrio_at) FROM dbo.agent_error_event WHERE id_issue = @id),
                  detalle = @detalle,
                  host = COALESCE(@host, host),
                  id_conversation = CASE WHEN @hayIds = 1 THEN @conv ELSE id_conversation END,
                  id_message = CASE WHEN @hayIds = 1 THEN @msg ELSE id_message END,
                  estado = CASE WHEN estado = N'resuelto' THEN N'abierto' ELSE estado END,
                  estado_por = CASE WHEN estado = N'resuelto' THEN N'recolector (volvió a pasar)' ELSE estado_por END,
                  estado_at = CASE WHEN estado = N'resuelto' THEN SYSUTCDATETIME() ELSE estado_at END
                OUTPUT INSERTED.ocurrencias
                WHERE id_issue = @id`);
            ocurrencias = Number(u.recordset[0]?.ocurrencias ?? 0);
          }
          await tx.commit();
          res.eventosNuevos += insertados;
          if (
            opciones.notificar &&
            debeNotificar(
              {
                severidad: base.severidad,
                estado: reabierta ? 'abierto' : estadoAntes,
                nueva,
                reabierta,
                eventosNuevos: insertados,
                notificadoEn: fila.notified_at instanceof Date ? fila.notified_at : null,
              },
              ahora,
              opciones.horas,
            )
          ) {
            res.notificar.push({
              huella,
              agente: base.agente,
              tipo: base.tipo,
              severidad: base.severidad,
              ambiente: base.ambiente,
              titulo: base.titulo,
              ocurrencias,
              nuevo: nueva || reabierta,
              idConversacion: ultimoConIds?.idConversacion ?? null,
            });
          }
        } catch (e) {
          await tx.rollback().catch(() => undefined);
          throw e;
        }
      }
      // Retención: las ocurrencias de más de 90 días se purgan (el contador del error se conserva).
      await pool.request().query(`DELETE TOP (5000) FROM dbo.agent_error_event WHERE ocurrio_at < DATEADD(DAY, -90, SYSUTCDATETIME())`);
      return res;
    }),
  );
}

/** El recolector confirma que el aviso salió: se anota la hora para no repetirlo antes de tiempo. */
export async function acusarNotificados(huellas: string[]): Promise<number> {
  if (huellas.length === 0) return 0;
  return conTablas(() =>
    withMssqlPool(async (pool) => {
      const rq = pool.request();
      const ph = huellas.map((h, i) => {
        rq.input(`h${i}`, sql.Char(64), h);
        return `@h${i}`;
      });
      const r = await rq.query(
        `UPDATE dbo.agent_error_issue SET notified_at = SYSUTCDATETIME() WHERE huella IN (${ph.join(',')})`,
      );
      return r.rowsAffected[0] ?? 0;
    }),
  );
}

/**
 * Da por resueltos los errores ABIERTOS de esas huellas (p. ej. una
 * automatización programada que volvió a correr bien). Si vuelve a pasar, la
 * publicación lo reabre y avisa como nuevo. Devuelve cuántos cerró.
 */
export async function resolverHuellas(huellas: string[], por: string): Promise<number> {
  const hs = [...new Set(huellas.filter((h) => /^[0-9a-f]{64}$/.test(h)))].slice(0, 1000);
  if (hs.length === 0) return 0;
  return conTablas(() =>
    withMssqlPool(async (pool) => {
      const r = await pool
        .request()
        .input('hs', sql.NVarChar(sql.MAX), JSON.stringify(hs))
        .input('por', sql.NVarChar(200), por.slice(0, 200)).query(`
          UPDATE dbo.agent_error_issue
             SET estado = N'resuelto', estado_por = @por, estado_at = SYSUTCDATETIME()
           WHERE estado = N'abierto' AND huella IN (SELECT value FROM OPENJSON(@hs))`);
      return r.rowsAffected[0] ?? 0;
    }),
  );
}

/** Ambiente de ESTE servidor (KRONOSDB = prod). */
export async function ambienteServidor(): Promise<Ambiente> {
  return withMssqlPool((pool) => ambienteDe(pool));
}

export type ResultadoReintento =
  | { ok: true; idMensaje: number; idConversacion: number }
  | { ok: false; status: 404 | 409; motivo: string };

/**
 * «Reintentar mensaje» (solo administración): vuelve a poner delivered_at =
 * NULL en el mensaje afectado para que el canal se lo entregue otra vez al
 * agente. Mismas guardas que synerlink-reinyectar.js del autoheal:
 *   - el error es de ESTE ambiente (un id de prod no significa nada en pruebas);
 *   - el mensaje existe, es de una persona (role 'user'), tiene menos de 7 días
 *     y ya estaba marcado como entregado;
 *   - la conversación es del MISMO agente del error y el agente está activo;
 *   - en la conversación no hay respuesta del agente posterior al mensaje
 *     (si la hay, pudo haberse contestado y no se arriesga un duplicado).
 * Todo en una transacción con UPDLOCK; si no se actualiza exactamente 1 fila,
 * ROLLBACK.
 */
export async function reintentarMensaje(idIssue: number, email: string): Promise<ResultadoReintento> {
  return conTablas(() =>
    withMssqlPool(async (pool) => {
      const f = await leerIssue(pool, idIssue);
      if (!f) return { ok: false, status: 404, motivo: 'No encontrado.' };
      const idMsg = num(f.id_message);
      if (!idMsg) return { ok: false, status: 409, motivo: 'Este error no trae un mensaje para reintentar.' };
      if ((await ambienteDe(pool)) !== String(f.ambiente))
        return {
          ok: false,
          status: 409,
          motivo: `El error es del ambiente «${String(f.ambiente)}»; el reintento solo se hace desde ese ambiente.`,
        };
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        const r = await new sql.Request(tx).input('m', sql.Int, idMsg).query(`
          SELECT m.id, m.id_conversation, m.role, m.created_at, m.delivered_at,
                 LOWER(a.code) AS code, a.is_active
          FROM dbo.chat_message m WITH (UPDLOCK, ROWLOCK)
          JOIN dbo.chat_conversation c ON c.id = m.id_conversation
          JOIN dbo.agent a ON a.id_agent = c.id_agent
          WHERE m.id = @m`);
        const x = r.recordset[0] as Fila | undefined;
        const rechazo = async (motivo: string): Promise<ResultadoReintento> => {
          await tx.rollback();
          return { ok: false, status: 409, motivo };
        };
        if (!x) return rechazo('El mensaje ya no existe.');
        if (String(x.code) !== String(f.agent_code).toLowerCase())
          return rechazo('El mensaje es de la conversación de otro agente.');
        if (!x.is_active) return rechazo('El agente está inactivo.');
        if (String(x.role) !== 'user') return rechazo('Solo se reintentan mensajes de personas.');
        if (!(x.created_at instanceof Date) || Date.now() - x.created_at.getTime() > 7 * 86_400_000)
          return rechazo('El mensaje tiene más de 7 días.');
        if (x.delivered_at === null) return rechazo('El mensaje ya está pendiente de entrega: el canal lo entregará solo.');
        const r2 = await new sql.Request(tx)
          .input('conv', sql.Int, Number(x.id_conversation))
          .input('t', sql.DateTime2, x.created_at)
          .query(`SELECT COUNT(*) AS n FROM dbo.chat_message WHERE id_conversation = @conv AND role <> 'user' AND created_at > @t`);
        const respuestas = Number(r2.recordset[0]?.n ?? 0);
        if (respuestas > 0)
          return rechazo(`La conversación ya tiene ${respuestas} respuesta(s) del agente después de ese mensaje.`);
        const u = await new sql.Request(tx)
          .input('m', sql.Int, idMsg)
          .query(`UPDATE dbo.chat_message SET delivered_at = NULL WHERE id = @m AND delivered_at IS NOT NULL`);
        if ((u.rowsAffected[0] ?? 0) !== 1) return rechazo('No se pudo marcar el mensaje (cambió mientras tanto).');
        await new sql.Request(tx)
          .input('id', sql.Int, idIssue)
          .input('por', sql.NVarChar(200), email.trim().toLowerCase())
          .query(`UPDATE dbo.agent_error_issue SET reintento_por = @por, reintento_at = SYSUTCDATETIME() WHERE id_issue = @id`);
        await tx.commit();
        return { ok: true, idMensaje: idMsg, idConversacion: Number(x.id_conversation) };
      } catch (e) {
        await tx.rollback().catch(() => undefined);
        throw e;
      }
    }),
  );
}
