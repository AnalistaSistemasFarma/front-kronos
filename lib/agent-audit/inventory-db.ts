/**
 * INVENTARIO DE AGENTES — parte que toca la base (Prisma). La validación, la
 * barrera contra secretos y las reglas de riesgo están en ./inventory.ts.
 */
import { prisma } from '../prisma';
import { evaluarHallazgos, type InventoryAgent, type InventoryPayload } from './inventory';

/** Una solicitud 'en_curso' más vieja que esto se da por perdida. */
export const SOLICITUD_VENCE_MS = 2 * 60 * 60 * 1000;

/** Marca como fallidas las solicitudes que el recolector tomó y nunca cerró. */
export async function vencerSolicitudesColgadas(ahora = new Date()): Promise<void> {
  await prisma.agentScanRequest.updateMany({
    where: {
      status: 'en_curso',
      started_at: { lt: new Date(ahora.getTime() - SOLICITUD_VENCE_MS) },
    },
    data: {
      status: 'fallido',
      finished_at: ahora,
      error_summary: 'El recolector tomó la solicitud y no terminó a tiempo.',
    },
  });
}

/** Sincroniza los hallazgos de un agente con lo que dice su último inventario. */
async function sincronizarHallazgos(idAgent: number, agente: InventoryAgent, ahora: Date) {
  const borradores = evaluarHallazgos(agente);
  const vigentes = new Set(borradores.map((b) => `${b.ruleCode}\u0000${b.subject}`));

  for (const b of borradores) {
    await prisma.agentAuditFinding.upsert({
      where: {
        id_agent_rule_code_subject: {
          id_agent: idAgent,
          rule_code: b.ruleCode,
          subject: b.subject,
        },
      },
      create: {
        id_agent: idAgent,
        rule_code: b.ruleCode,
        severity: b.severity,
        subject: b.subject,
        title: b.title,
        detail: b.detail,
        status: 'abierto',
        first_seen_at: ahora,
        last_seen_at: ahora,
      },
      update: {
        severity: b.severity,
        title: b.title,
        detail: b.detail,
        status: 'abierto',
        last_seen_at: ahora,
        resolved_at: null,
      },
    });
  }

  // Si el agente no se pudo leer, no se resuelve nada: no ver un riesgo no es
  // lo mismo que haberlo corregido.
  if (agente.error) return;

  const abiertos = await prisma.agentAuditFinding.findMany({
    where: { id_agent: idAgent, status: 'abierto' },
    select: { id: true, rule_code: true, subject: true },
  });
  const resolver = abiertos
    .filter((f) => !vigentes.has(`${f.rule_code}\u0000${f.subject}`))
    .map((f) => f.id);
  if (resolver.length > 0) {
    await prisma.agentAuditFinding.updateMany({
      where: { id: { in: resolver } },
      data: { status: 'resuelto', resolved_at: ahora },
    });
  }
}

export interface ResultadoIngesta {
  scanRequestId: number;
  guardados: string[];
  /** Códigos que no están registrados (o están inactivos) en SynerLink. */
  ignorados: string[];
}

export class SolicitudInvalidaError extends Error {}

/**
 * Guarda una corrida del recolector. Solo entran los agentes REGISTRADOS y
 * activos en la tabla `agent` (decisión de Nicolás, 2026-10-02); el resto se
 * informa como ignorado y no se guarda.
 */
export async function guardarInventario(p: InventoryPayload): Promise<ResultadoIngesta> {
  const ahora = new Date();

  let scanRequestId: number;
  if (p.scanRequestId) {
    const sol = await prisma.agentScanRequest.findUnique({
      where: { id: p.scanRequestId },
      select: { id: true, status: true },
    });
    if (!sol || sol.status !== 'en_curso') {
      throw new SolicitudInvalidaError('La solicitud de escaneo no existe o no está en curso.');
    }
    scanRequestId = sol.id;
  } else {
    const nueva = await prisma.agentScanRequest.create({
      data: {
        origin: 'programado',
        status: 'en_curso',
        started_at: p.startedAt ?? ahora,
        collector_host: p.collectorHost,
      },
      select: { id: true },
    });
    scanRequestId = nueva.id;
  }

  const registrados = await prisma.agent.findMany({
    where: { code: { in: p.agents.map((a) => a.code) }, is_active: true },
    select: { id_agent: true, code: true },
  });
  const idPorCodigo = new Map(registrados.map((r) => [r.code.toLowerCase(), r.id_agent]));

  const guardados: string[] = [];
  const ignorados: string[] = [];

  for (const a of p.agents) {
    const idAgent = idPorCodigo.get(a.code);
    if (!idAgent) {
      ignorados.push(a.code);
      continue;
    }
    await prisma.agentInventory.create({
      data: {
        id_agent: idAgent,
        id_scan_request: scanRequestId,
        scanned_at: ahora,
        kind: a.kind,
        host: a.host,
        location: a.location,
        model: a.model,
        service_status: a.serviceStatus,
        exec_mode: a.execMode,
        exec_requires_approval: a.execRequiresApproval,
        tools_json: JSON.stringify(a.tools),
        skills_json: JSON.stringify(a.skills),
        channels_json: JSON.stringify(a.channels),
        scan_error: a.error,
        mcps: {
          create: a.mcps.map((m) => ({
            name: m.name,
            transport: m.transport,
            target: m.target,
            company: m.company,
            access: m.access,
            auth: m.auth,
            write_tools: m.writeTools.length > 0 ? m.writeTools.join(', ').slice(0, 1000) : null,
          })),
        },
      },
      select: { id: true },
    });
    await sincronizarHallazgos(idAgent, a, ahora);
    guardados.push(a.code);
  }

  const notas = [
    ...p.errors,
    ...(ignorados.length > 0
      ? [`No registrados en SynerLink (no se guardaron): ${ignorados.join(', ')}`]
      : []),
  ];
  await prisma.agentScanRequest.update({
    where: { id: scanRequestId },
    data: {
      status: 'completado',
      finished_at: new Date(),
      collector_host: p.collectorHost,
      agents_scanned: guardados.length,
      error_summary: notas.length > 0 ? notas.join(' · ').slice(0, 2000) : null,
    },
  });

  return { scanRequestId, guardados, ignorados };
}

function parseLista<T>(raw: string | null, porDefecto: T): T {
  if (!raw) return porDefecto;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return porDefecto;
  }
}

/** Lo que pinta la pestaña Inventario: el último inventario de cada agente. */
export async function leerInventarioVigente() {
  const agentes = await prisma.agent.findMany({
    where: { is_active: true },
    select: {
      id_agent: true,
      code: true,
      display_name: true,
      handle: true,
      companies: { select: { company: { select: { company: true } } } },
    },
    orderBy: [{ sort_order: 'asc' }, { display_name: 'asc' }],
  });

  const ultimos = await prisma.agentInventory.groupBy({
    by: ['id_agent'],
    _max: { id: true },
  });
  const ids = ultimos.map((u) => u._max.id).filter((x): x is number => typeof x === 'number');
  const inventarios = ids.length
    ? await prisma.agentInventory.findMany({
        where: { id: { in: ids } },
        include: { mcps: { orderBy: { name: 'asc' } } },
      })
    : [];
  const invPorAgente = new Map(inventarios.map((i) => [i.id_agent, i]));

  const hallazgos = await prisma.agentAuditFinding.findMany({
    where: { status: 'abierto' },
    orderBy: [{ id_agent: 'asc' }, { id: 'asc' }],
  });
  const halPorAgente = new Map<number, typeof hallazgos>();
  for (const h of hallazgos) {
    const l = halPorAgente.get(h.id_agent) ?? [];
    l.push(h);
    halPorAgente.set(h.id_agent, l);
  }

  const [ultimoEscaneo, pendiente] = await Promise.all([
    prisma.agentScanRequest.findFirst({
      where: { status: { in: ['completado', 'fallido'] } },
      orderBy: { id: 'desc' },
    }),
    prisma.agentScanRequest.findFirst({
      where: { status: { in: ['pendiente', 'en_curso'] } },
      orderBy: { id: 'asc' },
    }),
  ]);

  const solicitud = (s: typeof ultimoEscaneo) =>
    s && {
      id: s.id,
      origin: s.origin,
      status: s.status,
      requestedBy: s.requested_by,
      requestedAt: s.requested_at.toISOString(),
      startedAt: s.started_at?.toISOString() ?? null,
      finishedAt: s.finished_at?.toISOString() ?? null,
      agentsScanned: s.agents_scanned,
      errorSummary: s.error_summary,
    };

  return {
    ultimoEscaneo: solicitud(ultimoEscaneo),
    solicitudPendiente: solicitud(pendiente),
    agentes: agentes.map((a) => {
      const inv = invPorAgente.get(a.id_agent);
      return {
        idAgent: a.id_agent,
        code: a.code,
        displayName: a.display_name,
        handle: a.handle,
        empresas: a.companies.map((c) => c.company.company.trim()),
        inventario: inv
          ? {
              scannedAt: inv.scanned_at.toISOString(),
              kind: inv.kind,
              host: inv.host,
              location: inv.location,
              model: inv.model,
              serviceStatus: inv.service_status,
              execMode: inv.exec_mode,
              execRequiresApproval: inv.exec_requires_approval,
              tools: parseLista(inv.tools_json, {
                allow: [] as string[],
                deny: [] as string[],
              }),
              skills: parseLista(inv.skills_json, [] as string[]),
              channels: parseLista(
                inv.channels_json,
                [] as {
                  type: string;
                  policy: string;
                  allowed: number | null;
                  detail: string | null;
                }[]
              ),
              scanError: inv.scan_error,
              mcps: inv.mcps.map((m) => ({
                name: m.name,
                transport: m.transport,
                target: m.target,
                company: m.company,
                access: m.access,
                auth: m.auth,
                writeTools: m.write_tools,
              })),
            }
          : null,
        hallazgos: (halPorAgente.get(a.id_agent) ?? []).map((h) => ({
          id: h.id,
          ruleCode: h.rule_code,
          severity: h.severity,
          subject: h.subject,
          title: h.title,
          detail: h.detail,
          firstSeenAt: h.first_seen_at.toISOString(),
        })),
      };
    }),
  };
}
