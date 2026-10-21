/**
 * HOJA DE VIDA COMPLETA (incremento 1, 2026-10-20) — parte que toca la base.
 * La lógica pura está en ./cv-completa.ts.
 *
 * DE DÓNDE SALE CADA DATO (nada de esto lee el TEXTO de las conversaciones):
 *   - credencial, arranque, rotación, personalidad y bloques de gobierno: el
 *     recolector (agent_inventory_runtime), solo huellas y fechas;
 *   - gobierno declarado (director, plantilla): agent_governance, editado a mano;
 *   - casos de SynerLink: agent_cv_case + requests_general/task_request_general
 *     EN VIVO (número, proceso, asunto, estado y tareas; nunca la descripción);
 *   - hallazgos de Gobierno IA: agent_external_finding, registrados a mano;
 *   - calidad de respuesta: chat_message (solo rol, autor, hilo y hora) y
 *     chat_message_delivery (hora de entrega al agente).
 */
import { Prisma } from '../../app/generated/prisma';
import { prisma } from '../prisma';
import { diaColombia, inicioDiaColombia, sumarDias } from './cv';
import {
  calidadRespuesta,
  cambiosGobierno,
  entregasConProblema,
  eventosRuntime,
  type BloqueGobierno,
  type GobiernoEntrada,
  type HallazgoExternoEntrada,
  type InventoryRuntime,
  type RelacionCaso,
} from './cv-completa';

// ── Escritura de lo que manda el recolector ──────────────────────────────────

/**
 * Guarda los datos de ejecución de una corrida, ligados al inventario que
 * guardarInventario() acaba de crear para cada agente en esa solicitud.
 */
export async function guardarRuntimes(scanRequestId: number, runtimes: Map<string, InventoryRuntime>) {
  if (runtimes.size === 0) return 0;
  const invs = await prisma.agentInventory.findMany({
    where: { id_scan_request: scanRequestId, agent: { code: { in: [...runtimes.keys()] } } },
    select: { id: true, agent: { select: { code: true } }, runtime: { select: { id_inventory: true } } },
  });
  let n = 0;
  for (const inv of invs) {
    const rt = runtimes.get(inv.agent.code.toLowerCase());
    if (!rt || inv.runtime) continue;
    await prisma.agentInventoryRuntime.create({ data: { id_inventory: inv.id, ...aFila(rt) } });
    n += 1;
  }
  return n;
}

function aFila(rt: InventoryRuntime) {
  return {
    auth_mode: rt.authMode,
    auth_detail: rt.authDetail,
    token_fingerprint: rt.tokenFingerprint,
    process_started_at: rt.processStartedAt,
    last_rotation_at: rt.lastRotationAt,
    last_rotation_status: rt.lastRotationStatus,
    last_rotation_detail: rt.lastRotationDetail,
    persona_fingerprint: rt.personaFingerprint,
    persona_files: rt.personaFiles.length ? rt.personaFiles.join(', ').slice(0, 500) : null,
    governance_json: rt.governance.length ? JSON.stringify(rt.governance) : null,
    usage_hook: rt.usageHook,
  };
}

type FilaRuntime = Prisma.AgentInventoryRuntimeGetPayload<object>;

function deFila(f: FilaRuntime): InventoryRuntime {
  let governance: BloqueGobierno[] = [];
  try {
    governance = f.governance_json ? (JSON.parse(f.governance_json) as BloqueGobierno[]) : [];
  } catch {
    governance = [];
  }
  return {
    authMode: (f.auth_mode ?? 'desconocido') as InventoryRuntime['authMode'],
    authDetail: f.auth_detail,
    tokenFingerprint: f.token_fingerprint,
    processStartedAt: f.process_started_at,
    lastRotationAt: f.last_rotation_at,
    lastRotationStatus: f.last_rotation_status,
    lastRotationDetail: f.last_rotation_detail,
    personaFingerprint: f.persona_fingerprint,
    personaFiles: f.persona_files ? f.persona_files.split(', ').filter(Boolean) : [],
    governance,
    usageHook: f.usage_hook,
  };
}

/**
 * Lleva a la línea de tiempo los reinicios, rotaciones, bloques de gobierno y
 * cambios de credencial o de personalidad. Idempotente (source_ref único por
 * agente), igual que reconstruirHistorial() de F2.
 */
export async function reconstruirEventosRuntime(opts: { desde?: Date | null } = {}) {
  const desde = opts.desde ?? null;
  const filas = await prisma.agentInventory.findMany({
    where: { runtime: { isNot: null }, scan_error: null, ...(desde ? { scanned_at: { gte: desde } } : {}) },
    select: { id: true, id_agent: true, scanned_at: true, runtime: true },
    orderBy: { id: 'asc' },
  });
  const porAgente = new Map<number, typeof filas>();
  for (const f of filas) porAgente.set(f.id_agent, [...(porAgente.get(f.id_agent) ?? []), f]);

  const entradas: Prisma.AgentCvEntryCreateManyInput[] = [];
  for (const [idAgent, lista] of porAgente) {
    // Punto de comparación: el último inventario con datos de ejecución ANTES de la ventana.
    const base = desde
      ? await prisma.agentInventory.findFirst({
          where: { id_agent: idAgent, runtime: { isNot: null }, scan_error: null, scanned_at: { lt: desde } },
          orderBy: { id: 'desc' },
          select: { runtime: true },
        })
      : null;
    let previo: InventoryRuntime | null = base?.runtime ? deFila(base.runtime) : null;
    for (const f of lista) {
      if (!f.runtime) continue;
      const actual = deFila(f.runtime);
      for (const e of eventosRuntime(previo, actual, f.scanned_at)) {
        entradas.push({
          id_agent: idAgent,
          occurred_at: e.occurredAt,
          kind: e.kind,
          title: e.title.slice(0, 300),
          detail: e.detail ? e.detail.slice(0, 2000) : null,
          source_ref: e.sourceRef.slice(0, 120),
        });
      }
      previo = actual;
    }
  }
  return { revisadas: entradas.length, creadas: await insertarNuevas(entradas) };
}

async function insertarNuevas(entradas: Prisma.AgentCvEntryCreateManyInput[]): Promise<number> {
  if (entradas.length === 0) return 0;
  const porAgente = new Map<number, Prisma.AgentCvEntryCreateManyInput[]>();
  for (const e of entradas) porAgente.set(e.id_agent, [...(porAgente.get(e.id_agent) ?? []), e]);
  let creadas = 0;
  for (const [idAgent, lista] of porAgente) {
    const existentes = new Set(
      (
        await prisma.agentCvEntry.findMany({
          where: { id_agent: idAgent, source_ref: { in: lista.map((e) => e.source_ref) } },
          select: { source_ref: true },
        })
      ).map((e) => e.source_ref)
    );
    const vistos = new Set<string>();
    const nuevas = lista.filter((e) => {
      if (existentes.has(e.source_ref) || vistos.has(e.source_ref)) return false;
      vistos.add(e.source_ref);
      return true;
    });
    if (nuevas.length === 0) continue;
    await prisma.agentCvEntry.createMany({ data: nuevas });
    creadas += nuevas.length;
  }
  return creadas;
}

// ── Calidad de respuesta ─────────────────────────────────────────────────────

type FilaPregunta = { id_agent: number; at: Date; respondida_at: Date | null };

/**
 * Preguntas de personas en los hilos DIRECTOS de uno o todos los agentes, con
 * la hora de la primera respuesta del agente. Solo horas: nunca el texto.
 */
async function preguntas(ini: Date, fin: Date, idAgent: number | null) {
  const filtro = idAgent === null ? Prisma.empty : Prisma.sql`AND c.id_agent = ${idAgent}`;
  return prisma.$queryRaw<FilaPregunta[]>(Prisma.sql`
    WITH m AS (
      SELECT x.id, x.id_conversation, x.created_at, x.role, c.id_agent,
        LAG(x.role) OVER (PARTITION BY x.id_conversation ORDER BY x.created_at, x.id) AS rol_previo
      FROM chat_message x
      JOIN chat_conversation c ON c.id = x.id_conversation
      WHERE c.kind = 'direct' AND x.event_type IS NULL
        AND x.created_at >= DATEADD(DAY, -1, ${ini}) AND x.created_at < ${fin} ${filtro}
    )
    SELECT u.id_agent, u.created_at AS at, r.created_at AS respondida_at
    FROM m u
    OUTER APPLY (
      SELECT TOP 1 y.created_at FROM chat_message y
      WHERE y.id_conversation = u.id_conversation AND y.role = 'agent' AND y.event_type IS NULL
        AND (y.created_at > u.created_at OR (y.created_at = u.created_at AND y.id > u.id))
      ORDER BY y.created_at, y.id
    ) r
    WHERE u.role = 'user' AND (u.rol_previo IS NULL OR u.rol_previo <> 'user')
      AND u.created_at >= ${ini}
  `);
}

type FilaEntrega = { id_agent: number; creado_at: Date; entregado_at: Date | null };

async function entregas(ini: Date, fin: Date, idAgent: number | null) {
  const filtro = idAgent === null ? Prisma.empty : Prisma.sql`AND d.id_agent = ${idAgent}`;
  return prisma.$queryRaw<FilaEntrega[]>(Prisma.sql`
    SELECT d.id_agent, m.created_at AS creado_at, d.delivered_at AS entregado_at
    FROM chat_message_delivery d
    JOIN chat_message m ON m.id = d.id_message
    WHERE m.created_at >= ${ini} AND m.created_at < ${fin} ${filtro}
  `);
}

/** Calidad de respuesta por agente en una ventana (para el resumen semanal). */
export async function calidadPorAgente(ini: Date, fin: Date) {
  const [ps, es] = await Promise.all([preguntas(ini, fin, null), entregas(ini, fin, null)]);
  const ids = new Set([...ps.map((p) => p.id_agent), ...es.map((e) => e.id_agent)]);
  const r = new Map<number, ReturnType<typeof calidadRespuesta> & ReturnType<typeof entregasConProblema>>();
  for (const id of ids) {
    r.set(id, {
      ...calidadRespuesta(ps.filter((p) => p.id_agent === id).map((p) => ({ at: p.at, respondidaAt: p.respondida_at }))),
      ...entregasConProblema(es.filter((e) => e.id_agent === id).map((e) => ({ creadoAt: e.creado_at, entregadoAt: e.entregado_at }))),
    });
  }
  return r;
}

// ── Casos de SynerLink vinculados ────────────────────────────────────────────

type FilaCaso = {
  id: number;
  subject_request: string | null;
  created_at: Date | null;
  date_resolution: Date | null;
  status: string | null;
  company: string | null;
  process: string | null;
};
type FilaTarea = {
  id: number;
  id_request_general: number;
  task: string | null;
  status: string | null;
  assigned: string | null;
  start_date: Date | null;
  date_resolution: Date | null;
};

async function casosEnVivo(ids: number[]) {
  if (ids.length === 0) return { casos: [] as FilaCaso[], tareas: [] as FilaTarea[] };
  const lista = Prisma.join(ids);
  const [casos, tareas] = await Promise.all([
    prisma.$queryRaw<FilaCaso[]>(Prisma.sql`
      SELECT rg.id, rg.subject_request, rg.created_at, rg.date_resolution, sc.status, c.company, pc.process
      FROM requests_general rg
      LEFT JOIN status_case sc ON sc.id_status_case = rg.status_req
      LEFT JOIN company c ON c.id_company = rg.id_company
      OUTER APPLY (
        SELECT TOP 1 p.process FROM process_category_request_general pcrg
        INNER JOIN process_category p ON p.id = pcrg.id_process_category
        WHERE pcrg.id_request_general = rg.id ORDER BY pcrg.id_process_category
      ) pc
      WHERE rg.id IN (${lista})
    `),
    prisma.$queryRaw<FilaTarea[]>(Prisma.sql`
      SELECT trg.id, trg.id_request_general, tpc.task, sc.status, ua.name AS assigned, trg.start_date, trg.date_resolution
      FROM task_request_general trg
      LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
      LEFT JOIN status_case sc ON sc.id_status_case = trg.id_status
      LEFT JOIN [user] ua ON ua.id = trg.id_assigned
      WHERE trg.id_request_general IN (${lista})
      ORDER BY trg.id
    `),
  ]);
  return { casos, tareas };
}

// ── Lectura de la ficha ──────────────────────────────────────────────────────

export async function leerHojaDeVidaCompleta(idAgent: number) {
  const hoy = diaColombia(new Date());
  const ini = inicioDiaColombia(sumarDias(hoy, -29));
  const fin = inicioDiaColombia(sumarDias(hoy, 1));

  const [ultimoConRuntime, gobierno, vinculos, externos, ps, es] = await Promise.all([
    prisma.agentInventory.findFirst({
      where: { id_agent: idAgent, runtime: { isNot: null } },
      orderBy: { id: 'desc' },
      select: { scanned_at: true, runtime: true },
    }),
    prisma.agentGovernance.findUnique({ where: { id_agent: idAgent } }),
    prisma.agentCvCase.findMany({ where: { id_agent: idAgent }, orderBy: { id_request: 'asc' } }),
    prisma.agentExternalFinding.findMany({
      where: { id_agent: idAgent },
      orderBy: [{ status: 'asc' }, { reported_on: 'desc' }, { id: 'desc' }],
    }),
    preguntas(ini, fin, idAgent),
    entregas(ini, fin, idAgent),
  ]);

  const rt = ultimoConRuntime?.runtime ? deFila(ultimoConRuntime.runtime) : null;

  // ¿Otros agentes usan la MISMA credencial? Se compara la huella del último
  // inventario de cada agente (nunca el valor).
  let compartidaCon: string[] = [];
  if (rt?.tokenFingerprint) {
    const ultimos = await prisma.agentInventory.groupBy({
      by: ['id_agent'],
      where: { runtime: { isNot: null } },
      _max: { id: true },
    });
    const mismos = await prisma.agentInventory.findMany({
      where: {
        id: { in: ultimos.map((u) => u._max.id).filter((x): x is number => typeof x === 'number') },
        id_agent: { not: idAgent },
        runtime: { token_fingerprint: rt.tokenFingerprint },
      },
      select: { agent: { select: { display_name: true } } },
    });
    compartidaCon = mismos.map((m) => m.agent.display_name.trim()).sort((a, b) => a.localeCompare(b, 'es'));
  }

  const vivo = await casosEnVivo(vinculos.map((v) => v.id_request)).catch(() => ({ casos: [] as FilaCaso[], tareas: [] as FilaTarea[] }));
  const casoPorId = new Map(vivo.casos.map((c) => [c.id, c]));
  const casos = vinculos.map((v) => {
    const c = casoPorId.get(v.id_request);
    return {
      idRequest: v.id_request,
      relation: v.relation,
      enEstaBase: Boolean(c),
      asunto: c?.subject_request?.trim() || v.title_snapshot,
      proceso: c?.process?.trim() ?? null,
      empresa: c?.company?.trim() ?? null,
      estado: c?.status?.trim() ?? null,
      creadoEl: c?.created_at?.toISOString() ?? null,
      resueltoEl: c?.date_resolution?.toISOString() ?? null,
      vinculadoPor: v.linked_by,
      vinculadoEl: v.linked_at.toISOString(),
      tareas: vivo.tareas
        .filter((t) => t.id_request_general === v.id_request)
        .map((t) => ({
          id: t.id,
          tarea: t.task?.trim() ?? 'Tarea',
          estado: t.status?.trim() ?? null,
          responsable: t.assigned?.trim() ?? null,
          inicio: t.start_date?.toISOString() ?? null,
          resueltaEl: t.date_resolution?.toISOString() ?? null,
        })),
    };
  });

  // Hechos de los casos para la línea de tiempo (en vivo, no se guardan).
  const eventosCasos = casos.flatMap((c) => [
    ...(c.creadoEl
      ? [{ occurredAt: c.creadoEl, kind: 'caso', title: `Se radicó el caso #${c.idRequest}`, detail: [c.proceso, c.asunto].filter(Boolean).join(' · ') || null }]
      : []),
    ...c.tareas
      .filter((t) => t.resueltaEl)
      .map((t) => ({
        occurredAt: t.resueltaEl as string,
        kind: 'caso',
        title: `Caso #${c.idRequest}: se resolvió «${t.tarea}»`,
        detail: t.responsable ? `Responsable: ${t.responsable}` : null,
      })),
  ]);

  return {
    ejecucion: rt
      ? {
          vistoEl: ultimoConRuntime!.scanned_at.toISOString(),
          authMode: rt.authMode,
          authDetail: rt.authDetail,
          tokenFingerprint: rt.tokenFingerprint,
          compartidaCon,
          processStartedAt: rt.processStartedAt?.toISOString() ?? null,
          lastRotationAt: rt.lastRotationAt?.toISOString() ?? null,
          lastRotationStatus: rt.lastRotationStatus,
          lastRotationDetail: rt.lastRotationDetail,
          personaFingerprint: rt.personaFingerprint,
          personaFiles: rt.personaFiles,
          governance: rt.governance,
          usageHook: rt.usageHook,
        }
      : null,
    gobierno: gobierno
      ? {
          directorName: gobierno.director_name,
          directorEmail: gobierno.director_email,
          privilegeTemplate: gobierno.privilege_template,
          privilegeAppliedOn: gobierno.privilege_applied_on?.toISOString().slice(0, 10) ?? null,
          notes: gobierno.notes,
          updatedBy: gobierno.updated_by,
          updatedAt: gobierno.updated_at.toISOString(),
        }
      : null,
    casos,
    eventosCasos,
    hallazgosExternos: externos.map((h) => ({
      id: h.id,
      source: h.source,
      refCode: h.ref_code,
      severity: h.severity,
      title: h.title,
      detail: h.detail,
      recommendation: h.recommendation,
      status: h.status,
      reportedOn: h.reported_on.toISOString().slice(0, 10),
      resolvedOn: h.resolved_on?.toISOString().slice(0, 10) ?? null,
      idRequest: h.id_request,
      createdBy: h.created_by,
    })),
    calidad30: {
      ...calidadRespuesta(ps.map((p) => ({ at: p.at, respondidaAt: p.respondida_at }))),
      ...entregasConProblema(es.map((e) => ({ creadoAt: e.creado_at, entregadoAt: e.entregado_at }))),
      reportaConsumo: rt?.usageHook ?? null,
    },
  };
}

export type HojaDeVidaCompleta = Awaited<ReturnType<typeof leerHojaDeVidaCompleta>>;

// ── Edición (permiso de configurar) ──────────────────────────────────────────

async function idDe(code: string) {
  return (await prisma.agent.findUnique({ where: { code }, select: { id_agent: true } }))?.id_agent ?? null;
}

async function anotar(idAgent: number, kind: string, title: string, detail: string | null, email: string, ref: string) {
  await prisma.agentCvEntry.create({
    data: {
      id_agent: idAgent,
      occurred_at: new Date(),
      kind,
      title: title.slice(0, 300),
      detail: detail ? detail.slice(0, 2000) : null,
      source_ref: ref.slice(0, 120),
      created_by: email,
    },
  });
}

export async function guardarGobierno(code: string, entrada: GobiernoEntrada, email: string) {
  const idAgent = await idDe(code);
  if (!idAgent) return null;
  const antes = await prisma.agentGovernance.findUnique({ where: { id_agent: idAgent } });
  const cambios = cambiosGobierno(
    antes
      ? {
          directorName: antes.director_name,
          directorEmail: antes.director_email,
          privilegeTemplate: antes.privilege_template,
          privilegeAppliedOn: antes.privilege_applied_on?.toISOString().slice(0, 10) ?? null,
          notes: antes.notes,
        }
      : null,
    entrada
  );
  if (cambios.length === 0) return { cambios };
  const ahora = new Date();
  const data = {
    director_name: entrada.directorName,
    director_email: entrada.directorEmail,
    privilege_template: entrada.privilegeTemplate,
    privilege_applied_on: entrada.privilegeAppliedOn ? new Date(`${entrada.privilegeAppliedOn}T00:00:00.000Z`) : null,
    notes: entrada.notes,
    updated_by: email,
    updated_at: ahora,
  };
  await prisma.agentGovernance.upsert({ where: { id_agent: idAgent }, create: { id_agent: idAgent, ...data }, update: data });
  await anotar(idAgent, 'gobierno', 'Se actualizó el gobierno del agente', cambios.join('\n'), email, `gobierno-edit:${ahora.getTime()}`);
  return { cambios };
}

export class VinculoError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

export async function vincularCaso(code: string, idRequest: number, relation: RelacionCaso, email: string) {
  const idAgent = await idDe(code);
  if (!idAgent) return null;
  const ya = await prisma.agentCvCase.findUnique({ where: { id_agent_id_request: { id_agent: idAgent, id_request: idRequest } } });
  if (ya) throw new VinculoError(`El caso #${idRequest} ya está vinculado.`, 409);
  const vivo = await casosEnVivo([idRequest]);
  const c = vivo.casos[0];
  if (!c) throw new VinculoError(`No existe el caso #${idRequest} en esta base.`, 404);
  await prisma.agentCvCase.create({
    data: { id_agent: idAgent, id_request: idRequest, relation, title_snapshot: c.subject_request?.trim().slice(0, 300) ?? null, linked_by: email },
  });
  await anotar(idAgent, 'caso', `Se vinculó el caso #${idRequest}`, [c.process?.trim(), c.subject_request?.trim()].filter(Boolean).join(' · ') || null, email, `caso:${idRequest}`);
  return { ok: true };
}

export async function desvincularCaso(code: string, idRequest: number, email: string) {
  const idAgent = await idDe(code);
  if (!idAgent) return null;
  const r = await prisma.agentCvCase.deleteMany({ where: { id_agent: idAgent, id_request: idRequest } });
  if (r.count === 0) throw new VinculoError(`El caso #${idRequest} no estaba vinculado.`, 404);
  await anotar(idAgent, 'caso', `Se desvinculó el caso #${idRequest}`, null, email, `caso-quita:${idRequest}:${Date.now()}`);
  return { ok: true };
}

export async function registrarHallazgoExterno(code: string, h: HallazgoExternoEntrada, email: string) {
  const idAgent = await idDe(code);
  if (!idAgent) return null;
  const ya = await prisma.agentExternalFinding.findUnique({
    where: { id_agent_source_ref_code: { id_agent: idAgent, source: h.source, ref_code: h.refCode } },
  });
  if (ya) throw new VinculoError(`Ya existe el hallazgo ${h.refCode} de esa fuente para este agente.`, 409);
  const creado = await prisma.agentExternalFinding.create({
    data: {
      id_agent: idAgent,
      source: h.source,
      ref_code: h.refCode,
      severity: h.severity,
      title: h.title,
      detail: h.detail,
      recommendation: h.recommendation,
      status: 'abierto',
      reported_on: new Date(`${h.reportedOn}T00:00:00.000Z`),
      id_request: h.idRequest,
      created_by: email,
    },
    select: { id: true },
  });
  await anotar(idAgent, 'hallazgo_externo', `Gobierno IA reportó el hallazgo ${h.refCode}`, h.title, email, `ext:${creado.id}:abre`);
  return { id: creado.id };
}

export async function cambiarEstadoHallazgoExterno(code: string, id: number, status: 'abierto' | 'resuelto' | 'aceptado', email: string) {
  const idAgent = await idDe(code);
  if (!idAgent) return null;
  const h = await prisma.agentExternalFinding.findFirst({ where: { id, id_agent: idAgent } });
  if (!h) throw new VinculoError('No existe ese hallazgo para este agente.', 404);
  if (h.status === status) return { ok: true, sinCambios: true };
  const ahora = new Date();
  await prisma.agentExternalFinding.update({
    where: { id },
    data: {
      status,
      resolved_on: status === 'abierto' ? null : new Date(`${diaColombia(ahora)}T00:00:00.000Z`),
      updated_by: email,
      updated_at: ahora,
    },
  });
  const verbo = status === 'resuelto' ? 'se cerró' : status === 'aceptado' ? 'se aceptó el riesgo de' : 'se reabrió';
  await anotar(idAgent, 'hallazgo_externo', `Gobierno IA: ${verbo} el hallazgo ${h.ref_code}`, h.title, email, `ext:${id}:${status}:${ahora.getTime()}`);
  return { ok: true };
}

// ── Insumos extra del resumen semanal (SOLO datos estructurados) ─────────────

/**
 * Lo que se suma a insumosResumen() de F2 por agente: gobierno declarado (sin
 * nombres de personas), calidad de respuesta y eventos de la semana. Nada de
 * texto de conversaciones ni nombres o correos.
 */
export async function insumosResumenCompleto(desde: string, hasta: string) {
  const ini = inicioDiaColombia(desde);
  const fin = inicioDiaColombia(sumarDias(hasta, 1));
  const [gob, casos, ext, calidad] = await Promise.all([
    prisma.agentGovernance.findMany({ select: { id_agent: true, privilege_template: true, privilege_applied_on: true, director_name: true } }),
    prisma.agentCvCase.findMany({ where: { relation: 'gobierno-ia' }, select: { id_agent: true, id_request: true } }),
    prisma.agentExternalFinding.findMany({ where: { status: 'abierto' }, select: { id_agent: true, severity: true } }),
    calidadPorAgente(ini, fin),
  ]);
  const agentes = await prisma.agent.findMany({ where: { is_active: true }, select: { id_agent: true, code: true } });
  const r: Record<string, unknown> = {};
  for (const a of agentes) {
    const g = gob.find((x) => x.id_agent === a.id_agent);
    const q = calidad.get(a.id_agent);
    r[a.code] = {
      gobierno: {
        plantillaMinimoPrivilegio: g?.privilege_template ?? null,
        aplicadaEl: g?.privilege_applied_on?.toISOString().slice(0, 10) ?? null,
        tieneDirector: Boolean(g?.director_name),
        casosGobiernoIA: casos.filter((c) => c.id_agent === a.id_agent).map((c) => c.id_request),
        hallazgosGobiernoIAAbiertos: ext.filter((e) => e.id_agent === a.id_agent).length,
      },
      calidadRespuesta: q
        ? {
            preguntas: q.preguntas,
            sinRespuesta: q.sinRespuesta,
            medianaSegundos: q.medianaSeg,
            p90Segundos: q.p90Seg,
            entregasTardias: q.tardias,
            entregasPendientes: q.pendientes,
          }
        : null,
    };
  }
  return r;
}
