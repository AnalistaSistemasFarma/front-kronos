/**
 * Medidor del consumo de Anthropic — lectura y escritura en la base (2026-10-22).
 * Reglas puras en ./consumo-anthropic.ts.
 */
import { prisma } from '../prisma';
import { tablaAusente } from '../chat/message-extras';
import type { CuotaAgenteDto, CuotaReportada, FuenteCuota } from './consumo-anthropic';

/** La tabla chat_agent_quota todavía no existe en esta base (el SQL del pase no se ha corrido). */
export class CuotaNoDisponible extends Error {
  constructor() {
    super('El medidor de consumo aún no está disponible en esta base.');
  }
}

function esTablaCuotaAusente(error: unknown): boolean {
  if (tablaAusente(error)) return true;
  return /Invalid object name 'dbo\.chat_agent_quota'/i.test((error as { message?: string } | null)?.message ?? '');
}

/**
 * Guarda el último cupo del agente. Una medición MÁS VIEJA que la guardada no
 * la pisa (dos turnos o una sonda y un turno pueden llegar desordenados).
 * Devuelve true si quedó guardada.
 */
export async function guardarCuota(idAgent: number, c: CuotaReportada): Promise<boolean> {
  const datos = {
    utilization_7d: c.utilizacion7d,
    reset_7d: c.reset7d,
    utilization_5h: c.utilizacion5h,
    reset_5h: c.reset5h,
    overage: c.overage,
    measured_at: c.medidoEn,
    source: c.fuente,
  };
  try {
    const actual = await prisma.chatAgentQuota.findUnique({ where: { id_agent: idAgent }, select: { measured_at: true } });
    if (!actual) {
      await prisma.chatAgentQuota.create({ data: { id_agent: idAgent, ...datos } });
      return true;
    }
    if (actual.measured_at.getTime() > c.medidoEn.getTime()) return false;
    await prisma.chatAgentQuota.update({ where: { id_agent: idAgent }, data: datos });
    return true;
  } catch (error) {
    if (esTablaCuotaAusente(error)) throw new CuotaNoDisponible();
    throw error;
  }
}

/** Cupo de los agentes designados en un proyecto (solo los que tienen dato). */
export async function cuotasDelProyecto(idProject: number): Promise<CuotaAgenteDto[]> {
  const designados = await prisma.chatProjectAgent.findMany({
    where: { id_project: idProject },
    select: { agent: { select: { id_agent: true, code: true, display_name: true } } },
    orderBy: { added_at: 'asc' },
  });
  return cuotasDe(designados.map((d) => d.agent));
}

/**
 * Cupo de UN agente (botón de consumo del chat, 2026-10-22). Lista vacía si
 * el agente no publica cuota o la tabla todavía no existe.
 */
export async function cuotaDelAgente(agente: { id_agent: number; code: string; display_name: string }): Promise<CuotaAgenteDto[]> {
  return cuotasDe([agente]);
}

async function cuotasDe(agentes: { id_agent: number; code: string; display_name: string }[]): Promise<CuotaAgenteDto[]> {
  const designados = agentes.map((agent) => ({ agent }));
  if (designados.length === 0) return [];
  let filas;
  try {
    filas = await prisma.chatAgentQuota.findMany({ where: { id_agent: { in: designados.map((d) => d.agent.id_agent) } } });
  } catch (error) {
    if (esTablaCuotaAusente(error)) return [];
    throw error;
  }
  const porAgente = new Map(filas.map((f) => [f.id_agent, f]));
  const salida: CuotaAgenteDto[] = [];
  for (const { agent } of designados) {
    const f = porAgente.get(agent.id_agent);
    if (!f) continue;
    salida.push({
      code: agent.code,
      displayName: agent.display_name,
      utilizacion7d: f.utilization_7d,
      reset7d: f.reset_7d?.toISOString() ?? null,
      utilizacion5h: f.utilization_5h,
      reset5h: f.reset_5h?.toISOString() ?? null,
      overage: f.overage,
      medidoEn: f.measured_at.toISOString(),
      fuente: (f.source === 'turno' ? 'turno' : 'sonda') as FuenteCuota,
    });
  }
  return salida;
}
