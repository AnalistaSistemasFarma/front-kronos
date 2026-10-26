/**
 * PERMISOS DE LOS AGENTES de un proyecto — lectura y escritura en la base.
 * Las reglas puras están en permisos-agentes-rules.ts.
 *
 * QUIÉN LOS CAMBIA (mismo esquema que la Auditoría de agentes, lib/chat/audit-access.ts):
 *   - la administración de SynerLink (rol admin o el permiso de Administración →
 *     Usuarios): en todas las empresas, sin asignárselo;
 *   - quien tenga el subproceso-permiso /process/proyectos/permisos-agentes en la
 *     EMPRESA del proyecto (Administración → Usuarios → Asignar subprocesos).
 * El DUEÑO del proyecto, por ser dueño, NO los cambia: dar acceso a código es
 * una decisión de la administración, no de quien crea el proyecto.
 *
 * EL CATÁLOGO de repositorios lo administra SOLO la administración.
 *
 * Cada cambio queda en chat_project_agent_policy_log (inmutable): quién, cuándo,
 * antes, después y motivo.
 *
 * COMPATIBILIDAD: si el código sale antes que el DDL, todo se lee como «ninguno»
 * (la lectura reconoce «la tabla no existe») y nadie puede guardar.
 */
import { prisma } from '../prisma';
import { checkAdminPrivileges } from '../access-control';
import {
  cargarOperadoresPases,
  mismaPolitica,
  NIVEL_INFO,
  nivelDesdeDb,
  parsearCorreos,
  PERMISOS_AGENTES_URL,
  POLITICA_POR_DEFECTO,
  resumenPolitica,
  serializarCorreos,
  type OperadorPases,
  type PoliticaEntrada,
  type RepoCatalogoEntrada,
} from './permisos-agentes-rules';
import type { CambioPoliticaDto, PoliticaAgentesDto, PoliticaPuenteDto, RepoCatalogoDto } from './permisos-agentes-tipos';

/* ─────────────────────────────── Utilidades ─────────────────────────────── */

/** ¿La tabla todavía no existe? (código desplegado antes que el DDL). */
export function tablaNoExiste(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; message?: unknown; meta?: { code?: unknown } };
  if (e.code === 'P2021') return true;
  if (e.meta?.code === '208' || e.meta?.code === 208) return true;
  return typeof e.message === 'string' && /Invalid object name '?(dbo\.)?chat_project_(agent_policy|repo_catalog)/i.test(e.message);
}

export class ErrorPermisos extends Error {
  constructor(
    mensaje: string,
    readonly status: number
  ) {
    super(mensaje);
  }
}

type RepoFila = {
  id_repo: number;
  slug: string;
  name: string;
  github: string;
  branch_testing: string;
  branch_production: string;
  description: string | null;
  active: boolean;
  updated_at: Date;
};

const repoSelect = {
  id_repo: true,
  slug: true,
  name: true,
  github: true,
  branch_testing: true,
  branch_production: true,
  description: true,
  active: true,
  updated_at: true,
} as const;

function aRepoDto(r: RepoFila, projectCount?: number): RepoCatalogoDto {
  return {
    idRepo: r.id_repo,
    slug: r.slug,
    name: r.name,
    github: r.github,
    branchTesting: r.branch_testing,
    branchProduction: r.branch_production,
    description: r.description,
    active: r.active,
    ...(projectCount !== undefined ? { projectCount } : {}),
    updatedAt: r.updated_at.toISOString(),
  };
}

function operadoresDe(correos: string[], operadores: OperadorPases[]): OperadorPases[] {
  return correos.map((e) => operadores.find((o) => o.email === e) ?? { email: e, name: e });
}

async function nombres(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))];
  if (unicos.length === 0) return new Map();
  const us = await prisma.user.findMany({ where: { id: { in: unicos } }, select: { id: true, name: true, email: true } });
  return new Map(us.map((u) => [u.id, u.name?.trim() || u.email]));
}

/* ─────────────────────────────── Permiso ─────────────────────────────── */

/** ¿Administra el catálogo de repositorios? Solo la administración de SynerLink. */
export async function esAdminCatalogo(email: string): Promise<boolean> {
  const correo = email.trim();
  return correo ? checkAdminPrivileges(correo) : false;
}

/** Empresas donde la persona tiene el subproceso-permiso (sin contar la administración). */
async function empresasConPermiso(email: string): Promise<number[]> {
  const filas = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email, isActive: true, NOT: { role: 'supplier' } } },
      subprocess: { subprocess_url: PERMISOS_AGENTES_URL },
    },
    select: { companyUser: { select: { id_company: true } } },
  });
  return [...new Set(filas.map((f) => f.companyUser.id_company))];
}

/** Dónde puede cambiar los permisos: `all` (administración) o una lista de empresas. */
export async function alcancePermisos(email: string): Promise<{ all: boolean; companyIds: number[] }> {
  const correo = email.trim();
  if (!correo) return { all: false, companyIds: [] };
  if (await checkAdminPrivileges(correo)) return { all: true, companyIds: [] };
  return { all: false, companyIds: await empresasConPermiso(correo) };
}

export async function puedeGestionarPermisos(email: string, idCompany: number): Promise<boolean> {
  const a = await alcancePermisos(email);
  return a.all || a.companyIds.includes(idCompany);
}

/* ─────────────────────────────── Catálogo ─────────────────────────────── */

/** Repos ACTIVOS (los que se pueden vincular). Sin tabla = lista vacía. */
export async function catalogoActivo(): Promise<RepoCatalogoDto[]> {
  try {
    const filas = await prisma.chatProjectRepoCatalog.findMany({ where: { active: true }, select: repoSelect, orderBy: { name: 'asc' } });
    return filas.map((r) => aRepoDto(r));
  } catch (error) {
    if (tablaNoExiste(error)) return [];
    throw error;
  }
}

/** Catálogo completo con cuántos proyectos usan cada repo (vista de la administración). */
export async function catalogoCompleto(): Promise<RepoCatalogoDto[]> {
  const filas = await prisma.chatProjectRepoCatalog.findMany({
    select: { ...repoSelect, _count: { select: { projects: true } } },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  });
  return filas.map((r) => aRepoDto(r, r._count.projects));
}

function valoresRepo(r: RepoFila | RepoCatalogoEntrada & { active?: boolean }) {
  const x = r as Record<string, unknown>;
  return {
    slug: x.slug,
    name: x.name,
    github: x.github,
    branchTesting: x.branch_testing ?? x.branchTesting,
    branchProduction: x.branch_production ?? x.branchProduction,
    description: x.description ?? null,
    active: x.active ?? true,
  };
}

/** Crea o edita un repo del catálogo. La clave (slug) no cambia al editar. */
export async function guardarRepo(opts: {
  actor: { id: string; email: string };
  idRepo?: number;
  entrada: RepoCatalogoEntrada;
  motivo: string;
}): Promise<RepoCatalogoDto> {
  const { actor, idRepo, entrada, motivo } = opts;
  return prisma.$transaction(async (tx) => {
    if (idRepo === undefined) {
      const existe = await tx.chatProjectRepoCatalog.findUnique({ where: { slug: entrada.slug }, select: { id_repo: true } });
      if (existe) throw new ErrorPermisos('Ya hay un repositorio con esa clave en el catálogo.', 409);
      const creado = await tx.chatProjectRepoCatalog.create({
        data: {
          slug: entrada.slug,
          name: entrada.name,
          github: entrada.github,
          branch_testing: entrada.branchTesting,
          branch_production: entrada.branchProduction,
          description: entrada.description,
          created_by: actor.id,
          updated_by: actor.id,
        },
        select: repoSelect,
      });
      await tx.chatProjectAgentPolicyLog.create({
        data: {
          scope: 'catalogo',
          id_repo: creado.id_repo,
          action: 'crear',
          before_value: null,
          after_value: JSON.stringify(valoresRepo(creado)),
          reason: motivo,
          changed_by: actor.id,
          changed_by_email: actor.email,
        },
      });
      return aRepoDto(creado);
    }
    const antes = await tx.chatProjectRepoCatalog.findUnique({ where: { id_repo: idRepo }, select: repoSelect });
    if (!antes) throw new ErrorPermisos('Repositorio no encontrado.', 404);
    const despues = await tx.chatProjectRepoCatalog.update({
      where: { id_repo: idRepo },
      data: {
        name: entrada.name,
        github: entrada.github,
        branch_testing: entrada.branchTesting,
        branch_production: entrada.branchProduction,
        description: entrada.description,
        updated_by: actor.id,
        updated_at: new Date(),
      },
      select: repoSelect,
    });
    await tx.chatProjectAgentPolicyLog.create({
      data: {
        scope: 'catalogo',
        id_repo: idRepo,
        action: 'cambiar',
        before_value: JSON.stringify(valoresRepo(antes)),
        after_value: JSON.stringify(valoresRepo(despues)),
        reason: motivo,
        changed_by: actor.id,
        changed_by_email: actor.email,
      },
    });
    return aRepoDto(despues);
  });
}

/** Activa o desactiva un repo. Desactivado: no se ofrece y el puente lo omite. No se borra. */
export async function cambiarActivoRepo(opts: { actor: { id: string; email: string }; idRepo: number; active: boolean; motivo: string }): Promise<RepoCatalogoDto> {
  const { actor, idRepo, active, motivo } = opts;
  return prisma.$transaction(async (tx) => {
    const antes = await tx.chatProjectRepoCatalog.findUnique({ where: { id_repo: idRepo }, select: repoSelect });
    if (!antes) throw new ErrorPermisos('Repositorio no encontrado.', 404);
    if (antes.active === active) return aRepoDto(antes);
    const despues = await tx.chatProjectRepoCatalog.update({
      where: { id_repo: idRepo },
      data: { active, updated_by: actor.id, updated_at: new Date() },
      select: repoSelect,
    });
    await tx.chatProjectAgentPolicyLog.create({
      data: {
        scope: 'catalogo',
        id_repo: idRepo,
        action: active ? 'activar' : 'desactivar',
        before_value: JSON.stringify(valoresRepo(antes)),
        after_value: JSON.stringify(valoresRepo(despues)),
        reason: motivo,
        changed_by: actor.id,
        changed_by_email: actor.email,
      },
    });
    return aRepoDto(despues);
  });
}

/* ─────────────────────────────── Política ─────────────────────────────── */

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Lee la fila y sus repos. null = el proyecto no tiene política (o la tabla aún no existe). */
async function leerFila(idProject: number, cliente: Tx | typeof prisma = prisma) {
  try {
    const p = await cliente.chatProjectAgentPolicy.findUnique({
      where: { id_project: idProject },
      select: { code_level: true, deploy_approvers: true, reason: true, updated_by: true, updated_at: true },
    });
    if (!p) return null;
    const repos = await cliente.chatProjectAgentPolicyRepo.findMany({
      where: { id_project: idProject },
      select: { repo: { select: repoSelect } },
      orderBy: { id_policy_repo: 'asc' },
    });
    return { ...p, repos: repos.map((r) => r.repo) };
  } catch (error) {
    if (tablaNoExiste(error)) return null;
    throw error;
  }
}

/** Política para la PANTALLA. Sin fila: «ninguno», sin repos. */
export async function leerPolitica(idProject: number, env: NodeJS.ProcessEnv = process.env): Promise<PoliticaAgentesDto> {
  const fila = await leerFila(idProject);
  if (!fila) return { codeLevel: 'ninguno', repos: [], deployApprovers: [], configurada: false, reason: null, updatedAt: null, updatedBy: null };
  const quien = await nombres([fila.updated_by]);
  return {
    codeLevel: nivelDesdeDb(fila.code_level),
    repos: fila.repos.map((r) => aRepoDto(r)),
    deployApprovers: operadoresDe(parsearCorreos(fila.deploy_approvers), cargarOperadoresPases(env)),
    configurada: true,
    reason: fila.reason,
    updatedAt: fila.updated_at.toISOString(),
    updatedBy: fila.updated_by ? quien.get(fila.updated_by) ?? 'Persona retirada' : null,
  };
}

function entradaDeFila(fila: NonNullable<Awaited<ReturnType<typeof leerFila>>> | null): PoliticaEntrada {
  if (!fila) return POLITICA_POR_DEFECTO;
  return { codeLevel: nivelDesdeDb(fila.code_level), repos: fila.repos.map((r) => r.slug), deployApprovers: parsearCorreos(fila.deploy_approvers) };
}

/** Registro de cambios de un proyecto, del más reciente al más antiguo. */
export async function registroPolitica(idProject: number, take = 30): Promise<CambioPoliticaDto[]> {
  try {
    const filas = await prisma.chatProjectAgentPolicyLog.findMany({
      where: { scope: 'proyecto', id_project: idProject },
      orderBy: [{ changed_at: 'desc' }, { id_log: 'desc' }],
      take,
      select: { id_log: true, action: true, before_value: true, after_value: true, reason: true, changed_by: true, changed_by_email: true, changed_at: true },
    });
    const quien = await nombres(filas.map((f) => f.changed_by));
    const resumen = (raw: string | null): string | null => {
      if (!raw) return null;
      try {
        return resumenPolitica(JSON.parse(raw) as PoliticaEntrada);
      } catch {
        return raw.slice(0, 200);
      }
    };
    return filas.map((f) => ({
      id: f.id_log,
      action: f.action as CambioPoliticaDto['action'],
      antes: resumen(f.before_value),
      despues: resumen(f.after_value) ?? '',
      reason: f.reason,
      changedBy: (f.changed_by ? quien.get(f.changed_by) : null) ?? f.changed_by_email ?? null,
      changedAt: f.changed_at.toISOString(),
    }));
  } catch (error) {
    if (tablaNoExiste(error)) return [];
    throw error;
  }
}

/**
 * Guarda la política (ya validada con normalizarPolitica). En UNA transacción:
 * la fila, sus repos y el registro con el antes y el después. Si no cambia
 * nada, no escribe y devuelve `cambio: false`.
 */
export async function guardarPolitica(opts: {
  idProject: number;
  actor: { id: string; email: string };
  entrada: PoliticaEntrada;
  motivo: string;
  cliente?: Tx;
}): Promise<{ cambio: boolean }> {
  const { idProject, actor, entrada, motivo } = opts;
  const hacer = async (tx: Tx) => {
    const fila = await leerFila(idProject, tx);
    const antes = entradaDeFila(fila);
    if (fila && mismaPolitica(antes, entrada)) return { cambio: false };

    const repos = entrada.repos.length
      ? await tx.chatProjectRepoCatalog.findMany({ where: { slug: { in: entrada.repos }, active: true }, select: { id_repo: true, slug: true } })
      : [];
    // El catálogo pudo cambiar entre la validación y aquí: si falta uno, no se guarda nada.
    if (repos.length !== entrada.repos.length) throw new ErrorPermisos('Alguno de los repositorios ya no está activo en el catálogo.', 409);

    const datos = {
      code_level: entrada.codeLevel,
      deploy_approvers: entrada.codeLevel === 'desarrollo_pases' ? serializarCorreos(entrada.deployApprovers) : null,
      reason: motivo,
      updated_by: actor.id,
      updated_at: new Date(),
    };
    if (fila) await tx.chatProjectAgentPolicy.update({ where: { id_project: idProject }, data: datos });
    else await tx.chatProjectAgentPolicy.create({ data: { id_project: idProject, ...datos } });

    await tx.chatProjectAgentPolicyRepo.deleteMany({ where: { id_project: idProject } });
    if (repos.length > 0) {
      await tx.chatProjectAgentPolicyRepo.createMany({ data: repos.map((r) => ({ id_project: idProject, id_repo: r.id_repo, added_by: actor.id })) });
    }
    await tx.chatProjectAgentPolicyLog.create({
      data: {
        scope: 'proyecto',
        id_project: idProject,
        action: fila ? 'cambiar' : 'crear',
        before_value: fila ? JSON.stringify(antes) : null,
        after_value: JSON.stringify(entrada),
        reason: motivo,
        changed_by: actor.id,
        changed_by_email: actor.email,
      },
    });
    return { cambio: true };
  };
  return opts.cliente ? hacer(opts.cliente) : prisma.$transaction(hacer);
}

/* ─────────────────────────────── Puente ─────────────────────────────── */

/**
 * Lo que lee el PUENTE. Los repos DESACTIVADOS en el catálogo se omiten; si un
 * nivel con código se queda sin repos, baja a «ninguno» (falla cerrado).
 * `sin-politica`: el proyecto no tiene fila (o la tabla aún no existe); el
 * puente decide (su archivo manual o «ninguno»).
 */
export async function politicaParaPuente(idProject: number): Promise<PoliticaPuenteDto> {
  const fila = await leerFila(idProject);
  if (!fila) {
    return { idProject, source: 'sin-politica', codeLevel: 'ninguno', level: 0, deploys: false, repos: [], deployApprovers: [], connectors: [], updatedAt: null };
  }
  const repos = fila.repos.filter((r) => r.active);
  let codeLevel = nivelDesdeDb(fila.code_level);
  if (codeLevel !== 'ninguno' && repos.length === 0) codeLevel = 'ninguno';
  const deployApprovers = codeLevel === 'desarrollo_pases' ? parsearCorreos(fila.deploy_approvers) : [];
  if (codeLevel === 'desarrollo_pases' && deployApprovers.length === 0) codeLevel = 'desarrollo';
  return {
    idProject,
    source: 'bd',
    codeLevel,
    level: NIVEL_INFO[codeLevel].numero,
    deploys: codeLevel === 'desarrollo_pases',
    repos:
      codeLevel === 'ninguno'
        ? []
        : repos.map((r) => ({ slug: r.slug, name: r.name, github: r.github, branchTesting: r.branch_testing, branchProduction: r.branch_production })),
    deployApprovers,
    connectors: [],
    updatedAt: fila.updated_at.toISOString(),
  };
}
