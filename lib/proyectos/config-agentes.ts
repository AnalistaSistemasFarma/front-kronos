/**
 * CONFIGURACIÓN de «Proyectos» por empresa — lectura y escritura en la base.
 * Las reglas puras (quién manda, validaciones) están en config-agentes-rules.ts.
 *
 * PERMISO DE LA PANTALLA (mismo esquema que la Auditoría de agentes,
 * lib/chat/audit-access.ts):
 *   - el subproceso-permiso /process/proyectos/configuracion, por empresa
 *     (Administración → Usuarios → Asignar subprocesos): configura SOLO las
 *     empresas donde se lo asignaron;
 *   - la administración de SynerLink (rol admin o el permiso de
 *     Administración → Usuarios): todas las empresas, sin asignárselo.
 *
 * PUENTE: solo se puede cambiar un agente que tenga llave de PROYECTOS
 * (scope "projects" en CHAT_AGENT_API_KEYS, lib/chat/agent-keys.ts). Sin ella
 * no hay quien atienda sus proyectos: la pantalla lo muestra «sin puente
 * activo» y en solo lectura.
 */
import { prisma } from '../prisma';
import { checkAdminPrivileges } from '../access-control';
import { loadAgentKeys } from '../chat/agent-keys';
import { loadProjectAgents } from '../chat/projects-rules';
import {
  configCerrada,
  configSoloEnv,
  construirConfig,
  filasCopiaInicial,
  MOTIVO_COPIA_ENV,
  parsearPerfiles,
  PROJECTS_CONFIG_URL,
  serializarPerfiles,
  type CambioConfig,
  type ConfigProyectos,
  type FilaConfigAgente,
} from './config-agentes-rules';
import type { ConfigEmpresaDto, EmpresaConfigurableDto } from './config-agentes-tipos';

/* ─────────────────────────────── Lectura ─────────────────────────────── */

/** ¿La tabla todavía no existe? (código desplegado antes que el DDL). */
export function tablaNoExiste(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; message?: unknown; meta?: { code?: unknown } };
  if (e.code === 'P2021') return true;
  // SQL Server 208 = «Invalid object name» (cuando llega por $queryRaw o sin código de Prisma).
  if (e.meta?.code === '208' || e.meta?.code === 208) return true;
  return typeof e.message === 'string' && /Invalid object name '?(dbo\.)?chat_project_agent_config/i.test(e.message);
}

/** Lee las filas unidas con el código del agente. Lanza si la base falla. */
async function leerFilas(): Promise<FilaConfigAgente[]> {
  const filas = await prisma.chatProjectAgentConfig.findMany({
    select: { id_company: true, id_agent: true, enabled: true, profiles: true, agent: { select: { code: true } } },
  });
  return filas.map((f) => ({ idCompany: f.id_company, idAgent: f.id_agent, code: f.agent.code, enabled: f.enabled, profiles: f.profiles }));
}

/**
 * Caché corta: la configuración se lee en cada puerta (bandeja del puente,
 * escribirle a un agente, listar designables). Es una tabla de pocas filas,
 * pero no hace falta ir a la base en cada consulta. Un cambio desde la
 * pantalla la invalida en este proceso (GSS-Front corre con UNA instancia,
 * RN de Nicolás del 2026-10-06); en el peor caso otro proceso tarda TTL.
 */
const TTL_MS = 10_000;
let cache: { at: number; envRaw: string; value: ConfigProyectos } | null = null;

export function invalidarConfigProyectos(): void {
  cache = null;
}

/**
 * Configuración EFECTIVA de Proyectos (tabla + .env). Nunca lanza:
 *   - tabla ausente (código antes que el DDL) → solo el .env, como antes;
 *   - cualquier otro error de lectura → no habilita a nadie (falla cerrado:
 *     no se puede saber si alguien apagó un agente en la tabla).
 */
export async function cargarConfigProyectos(env: NodeJS.ProcessEnv = process.env): Promise<ConfigProyectos> {
  const envRaw = (env.CHAT_PROJECTS_AGENTS ?? '').trim();
  if (cache && cache.envRaw === envRaw && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const value = construirConfig(await leerFilas(), loadProjectAgents(env));
    cache = { at: Date.now(), envRaw, value };
    return value;
  } catch (error) {
    if (tablaNoExiste(error)) return configSoloEnv(env);
    console.error('[proyectos/config] no se pudo leer la configuración; Proyectos queda cerrado:', (error as Error).message);
    return configCerrada();
  }
}

/** ¿Tiene el agente una llave de PROYECTOS (el puente de hilos)? */
export function tienePuente(code: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const c = code.trim().toLowerCase();
  return loadAgentKeys(env).some((k) => k.scope === 'projects' && k.agent.trim().toLowerCase() === c);
}

/* ─────────────────────────────── Permiso ─────────────────────────────── */

/** Empresas que la persona puede configurar. Vacío = no entra a la pantalla. */
export async function empresasConfigurables(email: string): Promise<{ admin: boolean; companies: EmpresaConfigurableDto[] }> {
  const correo = email.trim();
  if (!correo) return { admin: false, companies: [] };

  if (await checkAdminPrivileges(correo)) {
    const todas = await prisma.company.findMany({ select: { id_company: true, company: true }, orderBy: { company: 'asc' } });
    return { admin: true, companies: todas.map((c) => ({ idCompany: c.id_company, companyName: c.company.trim() })) };
  }

  const filas = await prisma.subprocessUserCompany.findMany({
    where: {
      companyUser: { user: { email: correo, isActive: true, NOT: { role: 'supplier' } } },
      subprocess: { subprocess_url: PROJECTS_CONFIG_URL },
    },
    select: { companyUser: { select: { company: { select: { id_company: true, company: true } } } } },
  });
  const out = new Map<number, EmpresaConfigurableDto>();
  for (const f of filas) {
    const c = f.companyUser.company;
    out.set(c.id_company, { idCompany: c.id_company, companyName: c.company.trim() });
  }
  return { admin: false, companies: [...out.values()].sort((a, b) => a.companyName.localeCompare(b.companyName)) };
}

/* ─────────────────────────────── Pantalla ─────────────────────────────── */

/** Agentes de la empresa, su estado efectivo y el registro de cambios. */
export async function vistaConfigEmpresa(idCompany: number, env: NodeJS.ProcessEnv = process.env): Promise<ConfigEmpresaDto> {
  const envMap = loadProjectAgents(env);

  let filas: FilaConfigAgente[] = [];
  let tablaLista = true;
  const detalle = new Map<number, { reason: string | null; updatedBy: string | null; updatedAt: Date }>();
  try {
    const crudas = await prisma.chatProjectAgentConfig.findMany({
      where: { id_company: idCompany },
      select: {
        id_agent: true,
        enabled: true,
        profiles: true,
        reason: true,
        updated_by: true,
        updated_at: true,
        agent: { select: { code: true } },
      },
    });
    filas = crudas.map((f) => ({ idCompany, idAgent: f.id_agent, code: f.agent.code, enabled: f.enabled, profiles: f.profiles }));
    for (const f of crudas) detalle.set(f.id_agent, { reason: f.reason, updatedBy: f.updated_by, updatedAt: f.updated_at });
  } catch (error) {
    if (!tablaNoExiste(error)) throw error;
    tablaLista = false;
  }
  const cfg = construirConfig(filas, envMap);

  const agentes = await prisma.agentCompany.findMany({
    where: { id_company: idCompany, agent: { is_active: true } },
    select: {
      agent: { select: { id_agent: true, code: true, display_name: true, handle: true, avatar_url: true, avatar_updated_at: true, sort_order: true } },
    },
  });
  agentes.sort((a, b) => a.agent.sort_order - b.agent.sort_order || a.agent.display_name.localeCompare(b.agent.display_name));

  let registro: ConfigEmpresaDto['registro'] = [];
  if (tablaLista) {
    const log = await prisma.chatProjectAgentConfigLog.findMany({
      where: { id_company: idCompany },
      orderBy: { changed_at: 'desc' },
      take: 100,
    });
    const nombresAgente = new Map(agentes.map((a) => [a.agent.id_agent, a.agent.display_name]));
    const ids = [...new Set([...log.map((l) => l.changed_by), ...[...detalle.values()].map((d) => d.updatedBy)].filter((x): x is string => !!x))];
    const personas = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
    const nombre = new Map(personas.map((p) => [p.id, p.name?.trim() || p.email]));
    registro = log.map((l) => ({
      id: l.id_log,
      agente: nombresAgente.get(l.id_agent) ?? `Asistente #${l.id_agent}`,
      accion: l.action === 'copia_env' ? 'copia_env' : 'cambio',
      habilitadoAntes: l.enabled_before,
      habilitadoDespues: l.enabled_after,
      perfilesAntes: parsearPerfiles(l.profiles_before) ?? [],
      perfilesDespues: parsearPerfiles(l.profiles_after) ?? [],
      motivo: l.reason,
      por: l.changed_by ? nombre.get(l.changed_by) ?? 'Persona retirada' : 'Sistema',
      fecha: l.changed_at.toISOString(),
    }));
    for (const [idAgent, d] of detalle) {
      if (d.updatedBy && !nombre.has(d.updatedBy)) nombre.set(d.updatedBy, 'Persona retirada');
      detalle.set(idAgent, { ...d, updatedBy: d.updatedBy ? nombre.get(d.updatedBy) ?? null : null });
    }
  }

  return {
    idCompany,
    origen: cfg.origen(idCompany),
    tablaLista,
    agentes: agentes.map(({ agent: a }) => {
      const d = detalle.get(a.id_agent);
      return {
        idAgent: a.id_agent,
        code: a.code,
        displayName: a.display_name,
        handle: a.handle,
        avatarUrl: a.avatar_url,
        avatarVersion: a.avatar_updated_at ? a.avatar_updated_at.getTime() : null,
        habilitado: cfg.habilitado(a.code, idCompany),
        perfiles: cfg.perfiles(a.code, idCompany),
        perfilesEnv: envMap.get(a.code.trim().toLowerCase()) ?? [],
        puente: tienePuente(a.code, env),
        configurado: !!d,
        ultimoCambio: d ? { motivo: d.reason, por: d.updatedBy, fecha: d.updatedAt.toISOString() } : null,
      };
    }),
    registro,
  };
}

/* ─────────────────────────────── Escritura ─────────────────────────────── */

export type ResultadoCambio = { ok: true; copiados: number } | { ok: false; status: number; error: string };

/**
 * Guarda el cambio de UN agente en UNA empresa, con su registro. Si la empresa
 * todavía no tenía filas (mandaba el .env), primero copia lo que el .env decía
 * para los demás agentes de la empresa: nada cambia sin que alguien lo decida.
 */
export async function guardarCambioConfig(
  idUser: string,
  cambio: CambioConfig,
  env: NodeJS.ProcessEnv = process.env
): Promise<ResultadoCambio> {
  const pertenece = await prisma.agentCompany.findUnique({
    where: { id_agent_id_company: { id_agent: cambio.idAgent, id_company: cambio.idCompany } },
    select: { agent: { select: { code: true, is_active: true } } },
  });
  if (!pertenece || !pertenece.agent.is_active) {
    return { ok: false, status: 404, error: 'Ese asistente no está activo en la empresa.' };
  }
  if (!tienePuente(pertenece.agent.code, env)) {
    return { ok: false, status: 409, error: 'Ese asistente no tiene puente activo para Proyectos: su configuración es de solo lectura.' };
  }

  const envMap = loadProjectAgents(env);
  // Deshabilitado conserva los perfiles escogidos (al volver a habilitarlo se recuerdan).
  const perfilesNuevos = serializarPerfiles(cambio.profiles);

  try {
    const copiados = await prisma.$transaction(async (tx) => {
      const existentes = await tx.chatProjectAgentConfig.findMany({
        where: { id_company: cambio.idCompany },
        select: { id_agent: true, enabled: true, profiles: true },
      });

      // 1. Primera vez para esta empresa: copia del .env (lo que hoy está vigente).
      let copiados = 0;
      let antes: { enabled: boolean; profiles: string | null };
      if (existentes.length === 0) {
        const agentes = await tx.agentCompany.findMany({
          where: { id_company: cambio.idCompany },
          select: { agent: { select: { id_agent: true, code: true } } },
        });
        const copia = filasCopiaInicial(
          agentes.map((a) => ({ idAgent: a.agent.id_agent, code: a.agent.code })),
          envMap,
          cambio.idAgent
        );
        for (const c of copia) {
          const perfiles = serializarPerfiles(c.profiles);
          await tx.chatProjectAgentConfig.create({
            data: { id_company: cambio.idCompany, id_agent: c.idAgent, enabled: true, profiles: perfiles, reason: MOTIVO_COPIA_ENV, updated_by: idUser },
          });
          await tx.chatProjectAgentConfigLog.create({
            data: {
              id_company: cambio.idCompany,
              id_agent: c.idAgent,
              action: 'copia_env',
              enabled_before: true,
              enabled_after: true,
              profiles_before: perfiles,
              profiles_after: perfiles,
              reason: MOTIVO_COPIA_ENV,
              changed_by: idUser,
            },
          });
        }
        copiados = copia.length;
        // Estado ANTES del agente que se cambia: el del .env.
        const delEnv = envMap.get(pertenece.agent.code.trim().toLowerCase()) ?? [];
        antes = { enabled: delEnv.length > 0, profiles: serializarPerfiles(delEnv) };
      } else {
        const fila = existentes.find((e) => e.id_agent === cambio.idAgent);
        antes = fila ? { enabled: fila.enabled, profiles: fila.profiles } : { enabled: false, profiles: null };
      }

      if (antes.enabled === cambio.enabled && (antes.profiles ?? '') === (perfilesNuevos ?? '') && existentes.length > 0) {
        throw new SinCambios();
      }

      // 2. El cambio pedido.
      await tx.chatProjectAgentConfig.upsert({
        where: { id_company_id_agent: { id_company: cambio.idCompany, id_agent: cambio.idAgent } },
        create: {
          id_company: cambio.idCompany,
          id_agent: cambio.idAgent,
          enabled: cambio.enabled,
          profiles: perfilesNuevos,
          reason: cambio.reason,
          updated_by: idUser,
        },
        update: { enabled: cambio.enabled, profiles: perfilesNuevos, reason: cambio.reason, updated_by: idUser, updated_at: new Date() },
      });
      await tx.chatProjectAgentConfigLog.create({
        data: {
          id_company: cambio.idCompany,
          id_agent: cambio.idAgent,
          action: 'cambio',
          enabled_before: antes.enabled,
          enabled_after: cambio.enabled,
          profiles_before: antes.profiles,
          profiles_after: perfilesNuevos,
          reason: cambio.reason,
          changed_by: idUser,
        },
      });
      return copiados;
    });
    return { ok: true, copiados };
  } catch (error) {
    if (error instanceof SinCambios) return { ok: false, status: 400, error: 'No hay cambios que guardar.' };
    if (tablaNoExiste(error)) {
      return { ok: false, status: 503, error: 'La configuración de Proyectos todavía no está instalada en la base de datos.' };
    }
    // Dos personas configurando la misma empresa por primera vez a la vez.
    if ((error as { code?: string }).code === 'P2002') {
      return { ok: false, status: 409, error: 'Otra persona acaba de cambiar esta configuración. Recargue e intente de nuevo.' };
    }
    throw error;
  } finally {
    invalidarConfigProyectos();
  }
}

class SinCambios extends Error {}
