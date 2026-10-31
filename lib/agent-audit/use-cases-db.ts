import "server-only";
import { sql, withMssqlPool } from "../mssqlPool";
import { agentInScope, type AuditScope } from "../chat/audit-access";

/**
 * AUDITORÍA DE AGENTES → CASOS DE USO. Lee el corte más reciente de
 * dbo.agent_use_summary / dbo.agent_use_case (prisma/manual/2026-10-29-casos-de-uso-agentes-*.sql),
 * que carga el análisis de conversaciones (scripts/agent-use-cases/generar_carga.py).
 * Sin modelo Prisma; si las tablas no existen, la pantalla dice «aún no habilitado».
 *
 * Alcance: el de la auditoría. Los agentes personales (agent_memory_setting.private_owner_email)
 * solo los ve su dueño, igual que en Memorias.
 */

export class CasosNoDisponibles extends Error {
  constructor() {
    super(
      "Los casos de uso de los agentes aún no están habilitados en este ambiente.",
    );
  }
}

export interface CasoDto {
  caso: string;
  descripcion: string | null;
  clase: string | null;
  ritmo: string | null;
  veces: number | null;
  vecesMes: number | null;
  semanas: number | null;
  personas: number | null;
  primera: string | null;
  ultima: string | null;
  area: string | null;
  sistemas: string | null;
  entregable: string | null;
  candidato: boolean;
}
export interface EnCursoDto {
  tema: string;
  estado: string | null;
}
export interface AgenteCasosDto {
  idAgent: number;
  code: string;
  displayName: string;
  empresa: string | null;
  departamento: string | null;
  rol: string | null;
  nivel: string;
  tareas: number;
  tareasRecientes: number;
  personas: number;
  horasBajo: number | null;
  horasBase: number | null;
  horasAlto: number | null;
  observaciones: string | null;
  hechos: CasoDto[];
  enCurso: EnCursoDto[];
}
export interface CasosDeUsoDto {
  corte: string | null;
  periodoDesde: string | null;
  agentes: AgenteCasosDto[];
}

type Fila = Record<string, unknown>;
const fecha = (v: unknown): string | null =>
  v instanceof Date && !Number.isNaN(v.getTime())
    ? v.toISOString().slice(0, 10)
    : null;
const n = (v: unknown): number | null =>
  v === null || v === undefined
    ? null
    : Number.isFinite(Number(v))
      ? Number(v)
      : null;
const s = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

export async function leerCasosDeUso(
  email: string,
  alcance: AuditScope,
): Promise<CasosDeUsoDto> {
  let r;
  try {
    r = await withMssqlPool((pool) =>
      pool
        .request()
        .input("email", sql.NVarChar(200), email.trim().toLowerCase()).query(`
        DECLARE @corte DATE = (SELECT MAX(corte) FROM dbo.agent_use_summary);

        SELECT su.id_agent, a.code, a.display_name, LTRIM(RTRIM(co.company)) AS empresa,
               su.departamento, su.rol_resumen, su.nivel_uso, su.tareas, su.tareas_recientes,
               su.personas, su.horas_bajo, su.horas_base, su.horas_alto, su.observaciones,
               su.corte, su.periodo_desde
        FROM dbo.agent_use_summary su
        JOIN dbo.agent a ON a.id_agent = su.id_agent
        LEFT JOIN dbo.agent_company ac ON ac.id_agent = a.id_agent AND ac.is_primary = 1
        LEFT JOIN dbo.company co ON co.id_company = ac.id_company
        LEFT JOIN dbo.agent_memory_setting ms ON ms.id_agent = a.id_agent
        WHERE su.corte = @corte AND a.is_active = 1
          AND (ms.private_owner_email IS NULL OR LOWER(ms.private_owner_email) = @email);

        SELECT uc.id_agent, uc.tipo, uc.caso, uc.descripcion, uc.clase, uc.ritmo, uc.veces,
               uc.veces_mes, uc.semanas, uc.personas, uc.primera, uc.ultima, uc.area,
               uc.sistemas, uc.entregable, uc.candidato_automatizar
        FROM dbo.agent_use_case uc
        WHERE uc.corte = @corte
        ORDER BY uc.id_agent, uc.id_case;
      `),
    );
  } catch (error) {
    if ((error as { number?: number } | null)?.number === 208)
      throw new CasosNoDisponibles();
    throw error;
  }
  const sets = r.recordsets as unknown as Fila[][];
  const porAgente = new Map<number, AgenteCasosDto>();
  let corte: string | null = null;
  let desde: string | null = null;
  for (const f of sets[0] ?? []) {
    const id = Number(f.id_agent);
    if (!agentInScope(alcance, id)) continue;
    corte = fecha(f.corte);
    desde = fecha(f.periodo_desde);
    porAgente.set(id, {
      idAgent: id,
      code: String(f.code),
      displayName: String(f.display_name),
      empresa: s(f.empresa),
      departamento: s(f.departamento),
      rol: s(f.rol_resumen),
      nivel: String(f.nivel_uso ?? "bajo"),
      tareas: Number(f.tareas ?? 0),
      tareasRecientes: Number(f.tareas_recientes ?? 0),
      personas: Number(f.personas ?? 0),
      horasBajo: n(f.horas_bajo),
      horasBase: n(f.horas_base),
      horasAlto: n(f.horas_alto),
      observaciones: s(f.observaciones),
      hechos: [],
      enCurso: [],
    });
  }
  for (const f of sets[1] ?? []) {
    const ag = porAgente.get(Number(f.id_agent));
    if (!ag) continue;
    if (f.tipo === "en_curso") {
      ag.enCurso.push({ tema: String(f.caso), estado: s(f.clase) });
    } else {
      ag.hechos.push({
        caso: String(f.caso),
        descripcion: s(f.descripcion),
        clase: s(f.clase),
        ritmo: s(f.ritmo),
        veces: n(f.veces),
        vecesMes: n(f.veces_mes),
        semanas: n(f.semanas),
        personas: n(f.personas),
        primera: fecha(f.primera),
        ultima: fecha(f.ultima),
        area: s(f.area),
        sistemas: s(f.sistemas),
        entregable: s(f.entregable),
        candidato: Boolean(f.candidato_automatizar),
      });
    }
  }
  return { corte, periodoDesde: desde, agentes: [...porAgente.values()] };
}
