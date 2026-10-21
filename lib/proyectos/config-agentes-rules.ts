/**
 * CONFIGURACIÓN de «Proyectos» por empresa — reglas PURAS (sin base de datos).
 *
 * Pedido de Nicolás Rivera del 2026-10-20 (12:44 COT): los agentes que pueden
 * trabajar en Proyectos dejan de definirse solo con CHAT_PROJECTS_AGENTS en el
 * .env del servidor y pasan a una pantalla de configuración del módulo
 * (/process/proyectos/configuracion), por empresa.
 *
 * -------------------------------------------------------------------------
 * QUIÉN MANDA (compatibilidad hacia atrás)
 * -------------------------------------------------------------------------
 *   - Empresa SIN filas en chat_project_agent_config → manda el .env, igual
 *     que antes del pase. Por eso el pase no cambia nada por sí solo.
 *   - Empresa CON al menos una fila → manda la tabla. Un agente sin fila en esa
 *     empresa NO está habilitado ahí.
 *   - Fila habilitada sin perfiles propios (profiles = NULL) → usa los perfiles
 *     del .env para ese agente. Sin perfiles por ningún lado = no habilitado
 *     (sin perfil no se puede crear ni atender un proyecto).
 *
 * Al guardar el PRIMER cambio de una empresa, lib/proyectos/config-agentes.ts
 * copia antes a la tabla lo que el .env decía para los agentes de esa empresa,
 * para que pasar de «manda el .env» a «manda la tabla» no apague a nadie sin
 * que alguien lo decida (filasCopiaInicial, abajo).
 *
 * Aquí vive todo lo que se puede probar sin Prisma; la lectura y la escritura
 * en la base están en lib/proyectos/config-agentes.ts.
 */
import { isKnownProfile, loadProjectAgents, PROJECT_PROFILES } from '../chat/projects-rules';

/** Subproceso-permiso de la CONFIGURACIÓN (marcador: no se lista en el menú). */
export const PROJECTS_CONFIG_URL = '/process/proyectos/configuracion';

/** ¿Es el marcador del permiso de configurar Proyectos? (para ocultarlo del hub). */
export function isProjectsConfigMarkerSubprocess(subprocess: { subprocess_url?: string | null }): boolean {
  return (subprocess.subprocess_url ?? '').toLowerCase().trim() === PROJECTS_CONFIG_URL;
}

/** Texto del distintivo en Administración → Usuarios. */
export const PROJECTS_CONFIG_MARKER_DESCRIPTION =
  'Permiso: configurar qué asistentes trabajan en Proyectos (en la empresa seleccionada)';

/** Motivo obligatorio de cada cambio (queda en el registro). */
export const MIN_CONFIG_REASON_CHARS = 5;
export const MAX_CONFIG_REASON_CHARS = 500;

/** Una fila de chat_project_agent_config ya unida con el código del agente. */
export interface FilaConfigAgente {
  idCompany: number;
  idAgent: number;
  code: string;
  enabled: boolean;
  /** Claves separadas por coma, o null = las del .env. */
  profiles: string | null;
}

/** Lee la columna `profiles`: solo claves conocidas, sin repetir, en orden. */
export function parsearPerfiles(raw: string | null | undefined): string[] | null {
  if (raw === null || raw === undefined) return null;
  const out: string[] = [];
  for (const parte of raw.split(',')) {
    const k = parte.trim();
    if (isKnownProfile(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Escribe la columna `profiles` (null si la lista está vacía). */
export function serializarPerfiles(perfiles: readonly string[] | null): string | null {
  if (!perfiles || perfiles.length === 0) return null;
  return perfiles.join(',');
}

/** Filtro Prisma (ChatProjectWhereInput) sin acoplarse al tipo generado. */
export type FiltroProyecto = Record<string, unknown>;

/** Lo que el resto del módulo pregunta: ¿este agente, en esta empresa, con qué perfiles? */
export interface ConfigProyectos {
  /** Perfiles con los que el agente trabaja en esa empresa. Vacío = no habilitado. */
  perfiles(code: string | null | undefined, idCompany: number): string[];
  habilitado(code: string | null | undefined, idCompany: number): boolean;
  /** ¿Puede atender proyectos en ALGUNA empresa? (puerta temprana del puente). */
  habilitadoEnAlguna(code: string | null | undefined): boolean;
  /** ¿Quién manda en esta empresa? */
  origen(idCompany: number): 'tabla' | 'env';
  /** Proyectos de empresas donde el agente está habilitado (bandeja y archivos del puente). */
  filtroEmpresas(code: string | null | undefined): FiltroProyecto;
  /** Lo mismo, además con el perfil del proyecto entre los habilitados (pedidos del equipo). */
  filtroAtendible(code: string | null | undefined): FiltroProyecto;
}

const NINGUNO: FiltroProyecto = { id_project: { in: [] } };

const norm = (code: string | null | undefined) => (code ?? '').trim().toLowerCase();

/**
 * Construye la configuración efectiva a partir de las filas de la tabla y del
 * mapa del .env (lib/chat/projects-rules.ts → loadProjectAgents).
 */
export function construirConfig(filas: readonly FilaConfigAgente[], env: Map<string, string[]>): ConfigProyectos {
  const configuradas = new Set<number>();
  // empresa → código → perfiles efectivos (solo las filas habilitadas con perfiles).
  const porEmpresa = new Map<number, Map<string, string[]>>();
  for (const f of filas) {
    configuradas.add(f.idCompany);
    if (!f.enabled) continue;
    const code = norm(f.code);
    const propios = parsearPerfiles(f.profiles);
    const perfiles = propios && propios.length > 0 ? propios : env.get(code) ?? [];
    if (perfiles.length === 0) continue;
    const m = porEmpresa.get(f.idCompany) ?? new Map<string, string[]>();
    m.set(code, perfiles);
    porEmpresa.set(f.idCompany, m);
  }

  const perfiles = (code: string | null | undefined, idCompany: number): string[] => {
    const c = norm(code);
    if (!c) return [];
    if (configuradas.has(idCompany)) return porEmpresa.get(idCompany)?.get(c) ?? [];
    return env.get(c) ?? [];
  };

  const empresasDeTabla = (c: string) => [...porEmpresa.entries()].filter(([, m]) => m.has(c)).map(([id]) => id);

  return {
    perfiles,
    habilitado: (code, idCompany) => perfiles(code, idCompany).length > 0,
    habilitadoEnAlguna: (code) => {
      const c = norm(code);
      if (!c) return false;
      return env.has(c) || empresasDeTabla(c).length > 0;
    },
    origen: (idCompany) => (configuradas.has(idCompany) ? 'tabla' : 'env'),
    filtroEmpresas: (code) => {
      const c = norm(code);
      if (!c) return NINGUNO;
      const deTabla = empresasDeTabla(c);
      const conEnv = env.has(c);
      // Sin ninguna empresa configurada: igual que antes del pase (solo el .env).
      if (conEnv && configuradas.size === 0) return {};
      const ramas: FiltroProyecto[] = [];
      if (deTabla.length > 0) ramas.push({ id_company: { in: deTabla } });
      if (conEnv) ramas.push({ id_company: { notIn: [...configuradas] } });
      if (ramas.length === 0) return NINGUNO;
      return ramas.length === 1 ? ramas[0] : { OR: ramas };
    },
    filtroAtendible: (code) => {
      const c = norm(code);
      if (!c) return NINGUNO;
      const ramas: FiltroProyecto[] = [];
      for (const id of empresasDeTabla(c)) {
        ramas.push({ id_company: id, profile: { in: porEmpresa.get(id)?.get(c) ?? [] } });
      }
      const envPerfiles = env.get(c);
      if (envPerfiles && envPerfiles.length > 0) {
        if (configuradas.size === 0) return { profile: { in: envPerfiles } };
        ramas.push({ id_company: { notIn: [...configuradas] }, profile: { in: envPerfiles } });
      }
      if (ramas.length === 0) return NINGUNO;
      return ramas.length === 1 ? ramas[0] : { OR: ramas };
    },
  };
}

/** Configuración SOLO con el .env (la tabla no existe todavía o está vacía). */
export function configSoloEnv(env: NodeJS.ProcessEnv = process.env): ConfigProyectos {
  return construirConfig([], loadProjectAgents(env));
}

/** Configuración que no habilita nada (falla cerrado ante un error de lectura). */
export function configCerrada(): ConfigProyectos {
  return construirConfig([], new Map());
}

/* ─────────────────────────── Escritura ─────────────────────────────── */

export type Validacion<T> = { ok: true; value: T } | { ok: false; error: string };

export interface CambioConfig {
  idCompany: number;
  idAgent: number;
  enabled: boolean;
  /** Perfiles escogidos. Habilitado exige al menos uno. */
  profiles: string[];
  reason: string;
}

const esId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** Valida lo que llega de la pantalla. */
export function validarCambio(raw: Record<string, unknown>): Validacion<CambioConfig> {
  const idCompany = typeof raw.company === 'string' ? Number.parseInt(raw.company, 10) : raw.company;
  if (!esId(idCompany)) return { ok: false, error: 'Empresa inválida.' };
  if (!esId(raw.idAgent)) return { ok: false, error: 'Asistente inválido.' };
  if (typeof raw.enabled !== 'boolean') return { ok: false, error: 'Indique si el asistente queda habilitado.' };

  if (!Array.isArray(raw.profiles)) return { ok: false, error: 'Los perfiles de conectores deben ser una lista.' };
  const profiles: string[] = [];
  for (const p of raw.profiles) {
    if (!isKnownProfile(p)) return { ok: false, error: `Perfil de conectores desconocido: ${String(p)}.` };
    if (!profiles.includes(p)) profiles.push(p);
  }
  if (raw.enabled && profiles.length === 0) {
    return { ok: false, error: 'Para habilitar el asistente escoja al menos un perfil de conectores.' };
  }

  const reason = typeof raw.reason === 'string' ? raw.reason.replace(/\s+/g, ' ').trim() : '';
  if (reason.length < MIN_CONFIG_REASON_CHARS) {
    return { ok: false, error: `Escriba el motivo del cambio (mínimo ${MIN_CONFIG_REASON_CHARS} caracteres): queda en el registro.` };
  }
  if (reason.length > MAX_CONFIG_REASON_CHARS) {
    return { ok: false, error: `El motivo no puede pasar de ${MAX_CONFIG_REASON_CHARS} caracteres.` };
  }
  return { ok: true, value: { idCompany, idAgent: raw.idAgent, enabled: raw.enabled, profiles, reason } };
}

/** Motivo de las filas que se copian del .env al configurar una empresa por primera vez. */
export const MOTIVO_COPIA_ENV =
  'Copia inicial de CHAT_PROJECTS_AGENTS: la empresa pasa a configurarse desde SynerLink.';

/**
 * Filas que se copian del .env cuando una empresa se configura por PRIMERA vez:
 * los agentes de la empresa que el .env habilitaba, con sus perfiles. El agente
 * que se está cambiando no se copia (su fila la escribe el cambio).
 */
export function filasCopiaInicial(
  agentesDeLaEmpresa: readonly { idAgent: number; code: string }[],
  env: Map<string, string[]>,
  idAgentCambiado: number
): { idAgent: number; profiles: string[] }[] {
  const out: { idAgent: number; profiles: string[] }[] = [];
  for (const a of agentesDeLaEmpresa) {
    if (a.idAgent === idAgentCambiado) continue;
    const perfiles = env.get(norm(a.code));
    if (perfiles && perfiles.length > 0) out.push({ idAgent: a.idAgent, profiles: [...perfiles] });
  }
  return out;
}

/** Etiquetas del catálogo, para la pantalla y el registro. */
export function etiquetasPerfiles(keys: readonly string[]): string {
  return keys.map((k) => PROJECT_PROFILES.find((p) => p.key === k)?.label ?? k).join(', ');
}
