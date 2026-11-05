/**
 * AGENTES DE DESARROLLO en Proyectos (2026-10-27) — lectura de la marca
 * agent.es_desarrollo. Las reglas puras están en agentes-desarrollo-rules.ts.
 *
 * FALLA CERRADO: si la columna todavía no existe (código desplegado antes que
 * el DDL), nadie es de desarrollo: no se puede dar código a ningún proyecto y
 * el puente recibe «ninguno». El orden del pase es SQL primero.
 */
import { prisma } from '../prisma';

export interface AgenteConMarca {
  idAgent: number;
  code: string;
  displayName: string;
  esDesarrollo: boolean;
}

/** ¿El error es «la columna es_desarrollo no existe»? */
export function columnaNoExiste(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; message?: unknown; meta?: { code?: unknown } };
  if (e.code === 'P2022') return true;
  if (e.meta?.code === '207' || e.meta?.code === 207) return true;
  return typeof e.message === 'string' && /Invalid column name '?es_desarrollo/i.test(e.message);
}

type Fila = { id_agent: number; code: string; display_name: string; es_desarrollo?: boolean | null };

function aDto(f: Fila): AgenteConMarca {
  return { idAgent: f.id_agent, code: f.code, displayName: f.display_name, esDesarrollo: f.es_desarrollo === true };
}

/** Los agentes pedidos con su marca. Sin columna: todos de negocio (falla cerrado). */
export async function marcarAgentes(idAgents: number[]): Promise<AgenteConMarca[]> {
  const ids = [...new Set(idAgents)];
  if (ids.length === 0) return [];
  try {
    const filas = await prisma.agent.findMany({
      where: { id_agent: { in: ids } },
      select: { id_agent: true, code: true, display_name: true, es_desarrollo: true },
    });
    return filas.map(aDto);
  } catch (error) {
    if (!columnaNoExiste(error)) throw error;
    const filas = await prisma.agent.findMany({ where: { id_agent: { in: ids } }, select: { id_agent: true, code: true, display_name: true } });
    return filas.map((f) => aDto({ ...f, es_desarrollo: false }));
  }
}

/** Ids de los agentes que SÍ son de desarrollo. */
export async function idsDesarrollo(idAgents: number[]): Promise<Set<number>> {
  return new Set((await marcarAgentes(idAgents)).filter((a) => a.esDesarrollo).map((a) => a.idAgent));
}

/** Agentes designados en un proyecto, con su marca. */
export async function agentesDelProyecto(idProject: number): Promise<AgenteConMarca[]> {
  const filas = await prisma.chatProjectAgent.findMany({ where: { id_project: idProject }, select: { id_agent: true }, orderBy: { id_project_agent: 'asc' } });
  const marcados = await marcarAgentes(filas.map((f) => f.id_agent));
  const porId = new Map(marcados.map((a) => [a.idAgent, a]));
  return filas.map((f) => porId.get(f.id_agent)).filter((a): a is AgenteConMarca => !!a);
}
