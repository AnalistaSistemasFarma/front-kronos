import 'server-only';
import { sql, withMssqlPool } from '../mssqlPool';
import { prisma } from '../prisma';
import { agentInScope, type AuditScope } from '../chat/audit-access';
import { aDto, type ProgramadaDto } from './scheduled-db';
import {
  ORDEN_PROG_EN_CURSO_VENCE_MS,
  ORDEN_PROG_PENDIENTE_VENCE_MS,
  NOMBRE_ACCION,
  textoOrdenProgramada,
  type AccionProgramada,
} from './scheduled-admin';
import { fechaCot } from './scheduled-salud';

/**
 * ADMINISTRAR AUTOMATIZACIONES PROGRAMADAS — base (2026-11-04).
 * Tablas: prisma/manual/2026-11-04-automatizaciones-admin-*.sql (sin modelo
 * Prisma). Sin ellas todo lanza AdminNoDisponible (503) y el indicador sigue
 * funcionando. Reglas puras en scheduled-admin.ts.
 */

export class AdminNoDisponible extends Error {
  constructor() {
    super('Administrar automatizaciones aún no está habilitado en este ambiente.');
  }
}

export class OrdenProgramadaActiva extends Error {
  constructor(public readonly orden: OrdenProgramadaDto) {
    super('Ya hay una orden en curso para esta automatización.');
  }
}

export class TransicionProgramadaInvalida extends Error {}

export type EstadoOrdenProg = 'pendiente' | 'en_curso' | 'ok' | 'ocupado' | 'error' | 'vencida';
const FINALES: readonly string[] = ['ok', 'ocupado', 'error'];

export function transicionProgValida(actual: string, nuevo: string): boolean {
  if (actual === 'pendiente') return nuevo === 'en_curso' || FINALES.includes(nuevo);
  if (actual === 'en_curso') return FINALES.includes(nuevo);
  return false;
}

export interface OrdenProgramadaDto {
  id: number;
  idJob: number | null;
  clave: string;
  host: string;
  tipo: string;
  ref: string;
  nombre: string;
  accion: AccionProgramada;
  status: EstadoOrdenProg;
  texto: string;
  requestedBy: string;
  requestedAt: string;
  takenAt: string | null;
  finishedAt: string | null;
  result: string | null;
  executor: string | null;
}

type Fila = Record<string, unknown>;
const esAusente = (e: unknown) => {
  const n = (e as { number?: number } | null)?.number;
  return n === 208 || n === 207; // tabla o columna inexistente
};
const esDuplicado = (e: unknown) => {
  const n = (e as { number?: number } | null)?.number;
  return n === 2601 || n === 2627;
};
const iso = (v: unknown) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString() : null);
const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));

async function conTablas<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (esAusente(e)) throw new AdminNoDisponible();
    throw e;
  }
}

function aOrden(f: Fila): OrdenProgramadaDto {
  const accion = String(f.accion) as AccionProgramada;
  const status = String(f.status) as EstadoOrdenProg;
  return {
    id: Number(f.id_command),
    idJob: f.id_job === null || f.id_job === undefined ? null : Number(f.id_job),
    clave: String(f.clave),
    host: String(f.host),
    tipo: String(f.tipo),
    ref: String(f.ref),
    nombre: String(f.nombre),
    accion,
    status,
    texto: textoOrdenProgramada(accion, status),
    requestedBy: String(f.requested_by),
    requestedAt: iso(f.requested_at) ?? '',
    takenAt: iso(f.taken_at),
    finishedAt: iso(f.finished_at),
    result: txt(f.result),
    executor: txt(f.executor),
  };
}

/** Vence las órdenes que nadie tomó o nadie cerró a tiempo (filtro opcional por clave o equipo). */
const SQL_VENCER = `
  UPDATE dbo.agent_scheduled_job_command
     SET status = N'vencida', finished_at = @ahora,
         result = CASE WHEN status = N'en_curso' THEN N'El equipo no reportó el resultado a tiempo.'
                       ELSE N'Ningún equipo tomó la orden (¿ejecutor apagado?).' END
   WHERE (@f_clave IS NULL OR clave = @f_clave) AND (@f_host IS NULL OR host = @f_host)
     AND ((status = N'pendiente' AND requested_at < @vence_pendiente)
       OR (status = N'en_curso' AND taken_at < @vence_en_curso));`;

function conVencer(req: sql.Request, ahora: Date, f: { clave?: string; host?: string }): sql.Request {
  return req
    .input('ahora', sql.DateTime2(0), ahora)
    .input('f_clave', sql.NVarChar(160), f.clave ?? null)
    .input('f_host', sql.NVarChar(40), f.host ?? null)
    .input('vence_pendiente', sql.DateTime2(0), new Date(ahora.getTime() - ORDEN_PROG_PENDIENTE_VENCE_MS))
    .input('vence_en_curso', sql.DateTime2(0), new Date(ahora.getTime() - ORDEN_PROG_EN_CURSO_VENCE_MS));
}

/**
 * Una automatización con su agente, si quien consulta la puede ver (alcance de
 * auditoría + reja de agentes personales). null si no existe o no la ve.
 */
export async function leerProgramada(idJob: number, email: string, alcance: AuditScope): Promise<ProgramadaDto | null> {
  return withMssqlPool(async (pool) => {
    const mem = await pool.request().query(`SELECT OBJECT_ID(N'dbo.agent_memory_setting', N'U') AS t`);
    const memorias = (mem.recordset as Fila[])[0]?.t !== null && (mem.recordset as Fila[])[0]?.t !== undefined;
    let r;
    try {
      r = await pool
        .request()
        .input('id', sql.Int, idJob)
        .input('email', sql.NVarChar(200), email.trim().toLowerCase()).query(`
          SELECT j.*, a.code, a.display_name, LTRIM(RTRIM(co.company)) AS empresa
          FROM dbo.agent_scheduled_job j
          JOIN dbo.agent a ON a.id_agent = j.id_agent
          LEFT JOIN dbo.agent_company ac ON ac.id_agent = a.id_agent AND ac.is_primary = 1
          LEFT JOIN dbo.company co ON co.id_company = ac.id_company
          ${memorias ? 'LEFT JOIN dbo.agent_memory_setting ms ON ms.id_agent = a.id_agent' : ''}
          WHERE j.id_job = @id AND a.is_active = 1
            ${memorias ? 'AND (ms.private_owner_email IS NULL OR LOWER(ms.private_owner_email) = @email)' : ''}`);
    } catch (e) {
      if ((e as { number?: number } | null)?.number === 208) return null;
      throw e;
    }
    const f = (r.recordset as Fila[])[0];
    if (!f || !agentInScope(alcance, Number(f.id_agent))) return null;
    return aDto(f);
  });
}

/** Últimas órdenes de una automatización (más nuevas primero). */
export async function ordenesDeProgramada(clave: string, top = 10): Promise<OrdenProgramadaDto[]> {
  const ahora = new Date();
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      conVencer(pool.request(), ahora, { clave })
        .input('clave', sql.NVarChar(160), clave)
        .input('top', sql.Int, top).query(`${SQL_VENCER}
          SELECT TOP (@top) * FROM dbo.agent_scheduled_job_command WHERE clave = @clave ORDER BY id_command DESC;`),
    );
    return (r.recordset as Fila[]).map(aOrden);
  });
}

export interface NuevaOrdenProgramada {
  job: ProgramadaDto;
  accion: AccionProgramada;
  requestedBy: string;
  ip: string | null;
  userAgent: string | null;
}

/** Registra la orden. Lanza OrdenProgramadaActiva si ya hay una pendiente o en curso. */
export async function crearOrdenProgramada(n: NuevaOrdenProgramada): Promise<OrdenProgramadaDto> {
  const ahora = new Date();
  const ref = n.job.ref;
  if (!ref) throw new Error('La automatización no tiene identificador administrable.');
  const orden = await conTablas(() =>
    withMssqlPool(async (pool) => {
      const tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const r = await conVencer(new sql.Request(tx), ahora, { clave: n.job.clave })
          .input('clave', sql.NVarChar(160), n.job.clave).query(`${SQL_VENCER}
            SELECT TOP 1 * FROM dbo.agent_scheduled_job_command WITH (UPDLOCK, HOLDLOCK)
            WHERE clave = @clave AND status IN (N'pendiente', N'en_curso') ORDER BY id_command DESC;`);
        const activa = (r.recordset as Fila[])[0];
        if (activa) {
          await tx.rollback();
          throw new OrdenProgramadaActiva(aOrden(activa));
        }
        const ins = await new sql.Request(tx)
          .input('id_job', sql.Int, n.job.id)
          .input('clave', sql.NVarChar(160), n.job.clave)
          .input('id_agent', sql.Int, n.job.idAgent)
          .input('host', sql.NVarChar(40), n.job.host)
          .input('tipo', sql.NVarChar(20), n.job.tipo)
          .input('ref', sql.NVarChar(200), ref)
          .input('nombre', sql.NVarChar(200), n.job.nombre.slice(0, 200))
          .input('accion', sql.NVarChar(16), n.accion)
          .input('por', sql.NVarChar(255), n.requestedBy.trim().toLowerCase().slice(0, 255))
          .input('ip', sql.NVarChar(64), n.ip?.slice(0, 64) ?? null)
          .input('ua', sql.NVarChar(300), n.userAgent?.slice(0, 300) ?? null)
          .input('t', sql.DateTime2(0), ahora).query(`
            INSERT INTO dbo.agent_scheduled_job_command
              (id_job, clave, id_agent, host, tipo, ref, nombre, accion, status, requested_by, requested_ip, requested_ua, requested_at)
            OUTPUT INSERTED.*
            VALUES (@id_job, @clave, @id_agent, @host, @tipo, @ref, @nombre, @accion, N'pendiente', @por, @ip, @ua, @t);`);
        await tx.commit();
        return aOrden((ins.recordset as Fila[])[0]);
      } catch (e) {
        if (e instanceof OrdenProgramadaActiva) throw e;
        await tx.rollback().catch(() => undefined);
        if (esDuplicado(e)) {
          const [otra] = await ordenesDeProgramada(n.job.clave, 1);
          if (otra) throw new OrdenProgramadaActiva(otra);
        }
        throw e;
      }
    }),
  );
  await anotarEnHojaDeVida(n.job.idAgent, orden, 'pedido', n.ip, n.userAgent);
  return orden;
}

/** Órdenes pendientes del EQUIPO de la llave del ejecutor (más viejas primero). */
export async function ordenesPendientesHost(host: string): Promise<OrdenProgramadaDto[]> {
  const ahora = new Date();
  return conTablas(async () => {
    const r = await withMssqlPool((pool) =>
      conVencer(pool.request(), ahora, { host })
        .input('host', sql.NVarChar(40), host).query(`${SQL_VENCER}
          SELECT TOP 20 * FROM dbo.agent_scheduled_job_command
          WHERE host = @host AND status = N'pendiente' ORDER BY id_command ASC;`),
    );
    return (r.recordset as Fila[]).map(aOrden);
  });
}

/**
 * El ejecutor reporta: 'en_curso' (la tomó) o un final ('ok' | 'ocupado' | 'error').
 * Solo órdenes de SU equipo (null si no existe para ese equipo). Con 'ok' en
 * pausar/reanudar, la automatización queda con el estado nuevo de inmediato
 * (el recolector lo confirma en su próxima pasada).
 */
export async function reportarOrdenProgramada(
  host: string,
  idCommand: number,
  estado: EstadoOrdenProg,
  detalle: string | null,
  ejecutor: string | null,
): Promise<OrdenProgramadaDto | null> {
  const ahora = new Date();
  const orden = await conTablas(() =>
    withMssqlPool(async (pool) => {
      const tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const r = await conVencer(new sql.Request(tx), ahora, { host })
          .input('id', sql.Int, idCommand)
          .input('host', sql.NVarChar(40), host).query(`${SQL_VENCER}
            SELECT * FROM dbo.agent_scheduled_job_command WITH (UPDLOCK, HOLDLOCK)
            WHERE id_command = @id AND host = @host;`);
        const f = (r.recordset as Fila[])[0];
        if (!f) {
          await tx.rollback();
          return null;
        }
        const actual = aOrden(f);
        if (!transicionProgValida(actual.status, estado)) {
          await tx.rollback();
          throw new TransicionProgramadaInvalida(`La orden está «${actual.status}»; no puede pasar a «${estado}».`);
        }
        const u = await new sql.Request(tx)
          .input('id', sql.Int, idCommand)
          .input('status', sql.NVarChar(16), estado)
          .input('result', sql.NVarChar(1000), detalle ? detalle.slice(0, 1000) : null)
          .input('executor', sql.NVarChar(120), ejecutor ? ejecutor.slice(0, 120) : null)
          .input('ahora', sql.DateTime2(0), ahora).query(`
            UPDATE dbo.agent_scheduled_job_command SET
              status = @status,
              taken_at = CASE WHEN @status = N'en_curso' THEN @ahora ELSE COALESCE(taken_at, @ahora) END,
              finished_at = CASE WHEN @status = N'en_curso' THEN NULL ELSE @ahora END,
              result = COALESCE(@result, result),
              executor = COALESCE(@executor, executor)
            OUTPUT INSERTED.*
            WHERE id_command = @id;`);
        const nueva = aOrden((u.recordset as Fila[])[0]);
        if (estado === 'ok' && (nueva.accion === 'pausar' || nueva.accion === 'reanudar')) {
          const pausar = nueva.accion === 'pausar';
          await new sql.Request(tx)
            .input('clave', sql.NVarChar(160), nueva.clave)
            .input('v', sql.Bit, pausar ? 0 : 1)
            .input('estado', sql.NVarChar(20), pausar ? 'pausada' : 'activa')
            .input(
              'det',
              sql.NVarChar(400),
              `${pausar ? 'Pausada' : 'Reanudada'} desde SynerLink por ${nueva.requestedBy} el ${fechaCot(ahora)}.`,
            ).query(`
              UPDATE dbo.agent_scheduled_job
                 SET cargada = @v, habilitada = @v, estado = @estado, estado_detalle = @det
               WHERE clave = @clave;`);
        }
        await tx.commit();
        return nueva;
      } catch (e) {
        if (!(e instanceof TransicionProgramadaInvalida)) await tx.rollback().catch(() => undefined);
        throw e;
      }
    }),
  );
  if (orden && estado !== 'en_curso') {
    const idAgent = await idAgenteDeOrden(orden.id);
    if (idAgent) await anotarEnHojaDeVida(idAgent, orden, 'resultado', null, null);
  }
  return orden;
}

async function idAgenteDeOrden(id: number): Promise<number | null> {
  try {
    const r = await withMssqlPool((pool) =>
      pool.request().input('id', sql.Int, id).query('SELECT id_agent FROM dbo.agent_scheduled_job_command WHERE id_command = @id'),
    );
    const v = (r.recordset as Fila[])[0]?.id_agent;
    return v === null || v === undefined ? null : Number(v);
  } catch {
    return null;
  }
}

/**
 * Deja la orden en la hoja de vida del agente (Auditoría de agentes): quién la
 * pidió, desde qué IP y navegador, y luego cómo terminó. Nunca hace fallar la orden.
 */
async function anotarEnHojaDeVida(
  idAgent: number,
  orden: OrdenProgramadaDto,
  momento: 'pedido' | 'resultado',
  ip: string | null,
  userAgent: string | null,
): Promise<void> {
  try {
    const accion = NOMBRE_ACCION[orden.accion];
    const entrada =
      momento === 'pedido'
        ? {
            title: `Automatización «${orden.nombre}»: orden de ${accion.toLowerCase()}`,
            detail: `Pedida por ${orden.requestedBy} desde ${ip ?? 'IP desconocida'} (${(userAgent ?? 'navegador desconocido').slice(0, 160)}). Equipo: ${orden.host}. Orden #${orden.id}.`,
            created_by: orden.requestedBy,
          }
        : {
            title: `Automatización «${orden.nombre}»: ${accion.toLowerCase()} — ${orden.status === 'ok' ? 'hecho' : orden.status}`,
            detail: `${orden.texto}${orden.result ? ` ${orden.result}` : ''} Orden #${orden.id}, pedida por ${orden.requestedBy}${orden.executor ? `, ejecutada en ${orden.executor}` : ''}.`,
            created_by: null,
          };
    await prisma.agentCvEntry.create({
      data: {
        id_agent: idAgent,
        occurred_at: new Date(),
        kind: 'automatizacion',
        title: entrada.title.slice(0, 300),
        detail: entrada.detail.slice(0, 2000),
        source_ref: `automatizacion:${orden.id}:${momento}`,
        created_by: entrada.created_by,
      },
    });
  } catch (error) {
    console.error('[agent-audit/scheduled-admin] no se pudo anotar la orden en la hoja de vida:', error);
  }
}
