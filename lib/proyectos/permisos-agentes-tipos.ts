/**
 * Permisos de los agentes de un proyecto (2026-10-20) — contratos entre la
 * API, la interfaz y el PUENTE de hilos. Solo tipos.
 */
import type { NivelCodigo, OperadorPases } from './permisos-agentes-rules';

export type { NivelCodigo, OperadorPases };

export interface RepoCatalogoDto {
  idRepo: number;
  slug: string;
  name: string;
  github: string;
  branchTesting: string;
  branchProduction: string;
  description: string | null;
  active: boolean;
  /** Proyectos que lo tienen vinculado (solo en la vista de la administración). */
  projectCount?: number;
  updatedAt: string;
}

export interface PoliticaAgentesDto {
  codeLevel: NivelCodigo;
  repos: RepoCatalogoDto[];
  deployApprovers: OperadorPases[];
  /** false = el proyecto no tiene fila: vale «ninguno» (valor seguro por defecto). */
  configurada: boolean;
  reason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface CambioPoliticaDto {
  id: number;
  action: 'crear' | 'cambiar' | 'activar' | 'desactivar';
  /** Resumen en español del antes (null al crear) y del después. */
  antes: string | null;
  despues: string;
  reason: string;
  changedBy: string | null;
  changedAt: string;
}

/** GET /api/proyectos/[id]/permisos */
export interface PermisosProyectoDto {
  policy: PoliticaAgentesDto;
  /** ¿Puede ESTA persona cambiarlos? (administración o el subproceso en la empresa del proyecto). */
  canEdit: boolean;
  /**
   * ¿Se le puede dar código? (2026-10-27) Solo si TODOS los agentes designados
   * son de desarrollo. Opcional: una respuesta vieja no lo trae y vale `true`.
   */
  codeAllowed?: boolean;
  /** Nombres de los agentes designados que NO son de desarrollo. */
  nonDevAgents?: string[];
  /** Repos ACTIVOS que se pueden vincular (solo si canEdit). */
  catalog: RepoCatalogoDto[];
  operators: OperadorPases[];
  log: CambioPoliticaDto[];
}

/** GET /api/proyectos/permisos-agentes — para «Nuevo proyecto» y la lista. */
export interface OpcionesPermisosDto {
  /** Empresas donde la persona puede escoger los permisos al crear. */
  editableCompanies: number[];
  /** ¿Administra el catálogo de repositorios? (solo la administración de SynerLink). */
  catalogAdmin: boolean;
  catalog: RepoCatalogoDto[];
  operators: OperadorPases[];
}

/**
 * GET /api/chat/agent/projects/policy — lo que LEE EL PUENTE (llave de scope
 * "projects"). `source: 'bd'` manda; `'sin-politica'` deja al puente usar su
 * archivo manual o «ninguno».
 */
export interface PoliticaPuenteDto {
  idProject: number;
  source: 'bd' | 'sin-politica';
  codeLevel: NivelCodigo;
  /** 0 ninguno · 1 lectura · 2 desarrollo · 3 desarrollo + pases. */
  level: 0 | 1 | 2 | 3;
  /** Pases (fusionar a testing o producción) permitidos con orden de un autorizador. */
  deploys: boolean;
  repos: { slug: string; name: string; github: string; branchTesting: string; branchProduction: string }[];
  deployApprovers: string[];
  /** Conectores adicionales: fase 2 (siempre vacío por ahora). */
  connectors: string[];
  updatedAt: string | null;
}
