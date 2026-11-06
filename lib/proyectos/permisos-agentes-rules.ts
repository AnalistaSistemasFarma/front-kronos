/**
 * PERMISOS DE LOS AGENTES de un proyecto — reglas PURAS (sin base de datos).
 *
 * Pedido de Nicolás Rivera (2026-10-20, 13:18 COT): «va a tocar que cuando
 * creemos el proyecto podamos elegir qué permisos tienen, porque así está
 * difícil». Hasta hoy el acceso de un agente al código de un proyecto se
 * configuraba a mano en un archivo del puente (`repos-por-proyecto.json`).
 * Con esto se escoge en la pantalla, al crear el proyecto o después.
 *
 * QUÉ SE ESCOGE (una política por proyecto, la comparten sus agentes):
 *   - Nivel de acceso a código: ninguno · lectura · desarrollo · desarrollo + pases.
 *   - Repositorios vinculados: del CATÁLOGO que administra la administración.
 *   - Quién autoriza los pases (solo en «desarrollo + pases»): un subconjunto
 *     de los OPERADORES AUTORIZADOS de producción (Nicolás Rivera y Cristian
 *     Baldión; memoria «operadores-autorizados-produccion»). Nadie más.
 *   - Conectores adicionales: DISEÑADO, no construido en este PR (ver
 *     CONECTORES_ADICIONALES_FASE). El perfil de conectores del proyecto sigue
 *     siendo el que manda.
 *
 * VALOR SEGURO POR DEFECTO: nivel «ninguno» y sin repositorios. Un proyecto
 * sin fila de política es «ninguno» (o, en el puente, lo que diga su archivo
 * manual mientras exista; ver puente-hilos/src/politica.mjs).
 */

/* ─────────────────────────────── Niveles ─────────────────────────────── */

export const NIVELES_CODIGO = ['ninguno', 'lectura', 'desarrollo', 'desarrollo_pases'] as const;
export type NivelCodigo = (typeof NIVELES_CODIGO)[number];

export interface InfoNivel {
  value: NivelCodigo;
  /** Número del nivel (el que usa el puente: 0 a 3). */
  numero: 0 | 1 | 2 | 3;
  label: string;
  description: string;
}

export const NIVEL_INFO: Record<NivelCodigo, InfoNivel> = {
  ninguno: {
    value: 'ninguno',
    numero: 0,
    label: 'Ninguno',
    description: 'Solo conversación e información del proyecto (correos, solicitudes y cronograma). Sin acceso a código.',
  },
  lectura: {
    value: 'lectura',
    numero: 1,
    label: 'Lectura',
    description: 'Lee y busca en los repositorios vinculados. No cambia nada.',
  },
  desarrollo: {
    value: 'desarrollo',
    numero: 2,
    label: 'Desarrollo',
    description: 'Trabaja en una copia propia (worktree): hace cambios, corre pruebas y abre PR. No fusiona ni despliega.',
  },
  desarrollo_pases: {
    value: 'desarrollo_pases',
    numero: 3,
    label: 'Desarrollo + pases',
    description:
      'Además fusiona a testing o a producción, SOLO cuando un operador autorizado lo ordena escribiendo él mismo en la conversación.',
  },
};

export function esNivelCodigo(v: unknown): v is NivelCodigo {
  return typeof v === 'string' && (NIVELES_CODIGO as readonly string[]).includes(v);
}

/** Lee el nivel guardado. Desconocido = «ninguno» (falla hacia lo más restringido). */
export function nivelDesdeDb(raw: string | null | undefined): NivelCodigo {
  return esNivelCodigo(raw) ? raw : 'ninguno';
}

/* ─────────────────────────────── Permiso ─────────────────────────────── */

/**
 * Subproceso-permiso para cambiar los permisos de los agentes (marcador, no
 * una página). Se otorga por persona y empresa en Administración → Usuarios.
 * La administración de SynerLink (rol admin o Administración → Usuarios) los
 * cambia en todas las empresas sin asignárselo.
 */
export const PERMISOS_AGENTES_URL = '/process/proyectos/permisos-agentes';
export const PERMISOS_AGENTES_MARKER_DESCRIPTION = 'Permiso: cambiar los permisos de los agentes en Proyectos';

export function isPermisosAgentesMarkerSubprocess(subprocess: { subprocess_url?: string | null } | null | undefined): boolean {
  return (subprocess?.subprocess_url ?? '').trim().toLowerCase() === PERMISOS_AGENTES_URL;
}

/* ───────────────────────── Operadores autorizados ───────────────────────── */

export interface OperadorPases {
  email: string;
  name: string;
}

/**
 * Operadores autorizados de producción (RN de Nicolás Rivera del 2026-10-06:
 * «actualmente los únicos operadores autorizados son Cristian y yo»). Solo
 * ellos pueden autorizar un pase. El .env los puede sobrescribir
 * (PROYECTOS_OPERADORES_PASES) para cuando Nicolás indique a alguien más.
 */
export const OPERADORES_PASES_POR_DEFECTO: readonly OperadorPases[] = [
  { email: 'nicolas.rivera@gsslatam.com', name: 'Nicolás Rivera' },
  { email: 'cristian.baldion@gsslatam.com', name: 'Cristian Baldión' },
];

const RE_CORREO = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/**
 * PROYECTOS_OPERADORES_PASES: JSON `[{"email":"…","name":"…"}]`. Inválido o
 * vacío = los de por defecto (nunca «nadie», nunca «cualquiera»).
 */
export function cargarOperadoresPases(env: NodeJS.ProcessEnv = process.env): OperadorPases[] {
  const raw = (env.PROYECTOS_OPERADORES_PASES ?? '').trim();
  if (!raw) return [...OPERADORES_PASES_POR_DEFECTO];
  try {
    const lista = JSON.parse(raw) as unknown;
    if (!Array.isArray(lista) || lista.length === 0) throw new Error('debe ser una lista no vacía');
    const out: OperadorPases[] = [];
    for (const o of lista) {
      const email = typeof (o as OperadorPases)?.email === 'string' ? (o as OperadorPases).email.trim().toLowerCase() : '';
      const name = typeof (o as OperadorPases)?.name === 'string' ? (o as OperadorPases).name.trim() : '';
      if (!RE_CORREO.test(email) || !name) throw new Error('cada operador necesita email y name');
      if (!out.some((x) => x.email === email)) out.push({ email, name });
    }
    return out;
  } catch (err) {
    console.error('[proyectos/permisos] PROYECTOS_OPERADORES_PASES inválido; se usan los de por defecto:', (err as Error).message);
    return [...OPERADORES_PASES_POR_DEFECTO];
  }
}

/* ─────────────────────────── Conectores (fase 2) ─────────────────────────── */

/**
 * Conectores o herramientas ADICIONALES por proyecto (SAP de solo lectura por
 * empresa, correo, SharePoint): quedan DISEÑADOS para una fase siguiente. La
 * columna `connectors` existe en la tabla (NULL) y el API para el puente
 * siempre devuelve `connectors: []`. Hoy el alcance de datos lo da el PERFIL
 * de conectores del proyecto, que no cambia después de crearlo.
 */
export const CONECTORES_ADICIONALES_FASE = 2;

/* ─────────────────────────── Catálogo de repos ─────────────────────────── */

/** Mismas reglas que el puente (puente-hilos/src/codigo.mjs): si no pasa aquí, allá tampoco. */
export const RE_SLUG_REPO = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const RE_GITHUB_REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export const RE_RAMA = /^[A-Za-z0-9._/-]{1,100}$/;

export const MAX_REPOS_POR_PROYECTO = 10;
export const MAX_NOMBRE_REPO = 120;
export const MAX_DESCRIPCION_REPO = 500;
export const MIN_MOTIVO = 10;
export const MAX_MOTIVO = 500;

export type Validacion<T> = { ok: true; value: T } | { ok: false; error: string };

export interface RepoCatalogoEntrada {
  slug: string;
  name: string;
  github: string;
  branchTesting: string;
  branchProduction: string;
  description: string | null;
}

function texto(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

export function normalizarRepoCatalogo(raw: unknown, { editando = false }: { editando?: boolean } = {}): Validacion<RepoCatalogoEntrada> {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Datos del repositorio inválidos.' };
  const r = raw as Record<string, unknown>;
  const slug = texto(r.slug).toLowerCase();
  if (!editando && !RE_SLUG_REPO.test(slug)) {
    return { ok: false, error: 'La clave del repositorio va en minúsculas, con letras, números y guiones (máx. 40).' };
  }
  const name = texto(r.name);
  if (!name || name.length > MAX_NOMBRE_REPO) return { ok: false, error: `El nombre es obligatorio (máx. ${MAX_NOMBRE_REPO} caracteres).` };
  const github = texto(r.github);
  if (!RE_GITHUB_REPO.test(github)) return { ok: false, error: 'El repositorio de GitHub va como «dueño/repositorio».' };
  const branchTesting = texto(r.branchTesting);
  const branchProduction = texto(r.branchProduction);
  if (!RE_RAMA.test(branchTesting) || !RE_RAMA.test(branchProduction)) {
    return { ok: false, error: 'Indique la rama de pruebas y la de producción.' };
  }
  if (branchTesting === branchProduction) return { ok: false, error: 'La rama de pruebas y la de producción no pueden ser la misma.' };
  const descripcion = typeof r.description === 'string' ? r.description.trim() : '';
  if (descripcion.length > MAX_DESCRIPCION_REPO) return { ok: false, error: `La descripción no puede pasar de ${MAX_DESCRIPCION_REPO} caracteres.` };
  return { ok: true, value: { slug, name, github, branchTesting, branchProduction, description: descripcion || null } };
}

/* ─────────────────────────────── Política ─────────────────────────────── */

export interface PoliticaEntrada {
  codeLevel: NivelCodigo;
  /** Claves (slug) de repos del catálogo ACTIVO, sin duplicados. */
  repos: string[];
  /** Correos de operadores; solo en «desarrollo_pases». */
  deployApprovers: string[];
}

export const POLITICA_POR_DEFECTO: PoliticaEntrada = { codeLevel: 'ninguno', repos: [], deployApprovers: [] };

/**
 * Valida la política que llega del cliente contra el catálogo activo y los
 * operadores. Reglas:
 *   - «ninguno» no lleva repos (se descartan) ni autorizadores;
 *   - lectura y superiores exigen al menos un repo, todos del catálogo ACTIVO;
 *   - «desarrollo_pases» exige al menos un autorizador y SOLO operadores; si no
 *     se indica ninguno, son todos los operadores (el valor por defecto que pidió Nicolás);
 *   - en los demás niveles no hay autorizadores (no hay pases).
 */
export function normalizarPolitica(
  raw: unknown,
  { catalogoActivo, operadores }: { catalogoActivo: readonly string[]; operadores: readonly OperadorPases[] }
): Validacion<PoliticaEntrada> {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Los permisos de los agentes son inválidos.' };
  const r = raw as Record<string, unknown>;
  if (!esNivelCodigo(r.codeLevel)) return { ok: false, error: 'Escoja el nivel de acceso a código.' };
  const codeLevel = r.codeLevel;

  if (r.repos !== undefined && !Array.isArray(r.repos)) return { ok: false, error: 'Repositorios inválidos.' };
  const repos: string[] = [];
  for (const item of (r.repos as unknown[] | undefined) ?? []) {
    const slug = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (!RE_SLUG_REPO.test(slug)) return { ok: false, error: 'Repositorio inválido.' };
    if (!repos.includes(slug)) repos.push(slug);
  }

  if (codeLevel === 'ninguno') return { ok: true, value: { codeLevel, repos: [], deployApprovers: [] } };

  if (repos.length === 0) return { ok: false, error: 'Con acceso a código, vincule al menos un repositorio.' };
  if (repos.length > MAX_REPOS_POR_PROYECTO) return { ok: false, error: `Un proyecto puede vincular hasta ${MAX_REPOS_POR_PROYECTO} repositorios.` };
  const activos = new Set(catalogoActivo);
  if (repos.some((s) => !activos.has(s))) {
    return { ok: false, error: 'Alguno de los repositorios no está en el catálogo o fue desactivado.' };
  }

  if (codeLevel !== 'desarrollo_pases') return { ok: true, value: { codeLevel, repos, deployApprovers: [] } };

  if (r.deployApprovers !== undefined && !Array.isArray(r.deployApprovers)) return { ok: false, error: 'Autorizadores inválidos.' };
  const permitidos = new Set(operadores.map((o) => o.email.toLowerCase()));
  const aprobadores: string[] = [];
  for (const item of (r.deployApprovers as unknown[] | undefined) ?? []) {
    const email = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (!permitidos.has(email)) return { ok: false, error: 'Solo los operadores autorizados de producción pueden autorizar pases.' };
    if (!aprobadores.includes(email)) aprobadores.push(email);
  }
  const deployApprovers = aprobadores.length > 0 ? aprobadores : operadores.map((o) => o.email.toLowerCase());
  if (deployApprovers.length === 0) return { ok: false, error: 'Debe haber al menos una persona que autorice los pases.' };
  return { ok: true, value: { codeLevel, repos, deployApprovers } };
}

/** Motivo del cambio: obligatorio para auditar (quién, cuándo, antes, después y POR QUÉ). */
export function normalizarMotivo(raw: unknown): Validacion<string> {
  const v = typeof raw === 'string' ? raw.replace(/\r\n/g, '\n').trim() : '';
  if (v.length < MIN_MOTIVO) return { ok: false, error: `Escriba el motivo del cambio (mínimo ${MIN_MOTIVO} caracteres).` };
  if (v.length > MAX_MOTIVO) return { ok: false, error: `El motivo no puede pasar de ${MAX_MOTIVO} caracteres.` };
  return { ok: true, value: v };
}

/** Autorizadores guardados: correos separados por coma. */
export function serializarCorreos(lista: readonly string[]): string | null {
  return lista.length > 0 ? lista.join(',') : null;
}

export function parsearCorreos(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const p of raw.split(',')) {
    const e = p.trim().toLowerCase();
    if (RE_CORREO.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

/** ¿Cambió algo? (para no registrar un «cambio» que no cambia nada). */
export function mismaPolitica(a: PoliticaEntrada, b: PoliticaEntrada): boolean {
  const igual = (x: string[], y: string[]) => x.length === y.length && [...x].sort().every((v, i) => v === [...y].sort()[i]);
  return a.codeLevel === b.codeLevel && igual(a.repos, b.repos) && igual(a.deployApprovers, b.deployApprovers);
}

/** Resumen de una línea, en español, para el registro y los avisos. */
export function resumenPolitica(p: PoliticaEntrada): string {
  const nivel = NIVEL_INFO[p.codeLevel].label;
  if (p.codeLevel === 'ninguno') return nivel;
  const repos = p.repos.join(', ');
  const aut = p.codeLevel === 'desarrollo_pases' ? ` · pases: ${p.deployApprovers.join(', ')}` : '';
  return `${nivel} · ${repos}${aut}`;
}
