/**
 * PERMISOS DE LOS AGENTES del proyecto, vistos desde el PUENTE (2026-10-20).
 *
 * Pedido de Nicolás Rivera (13:18 COT): «va a tocar que cuando creemos el
 * proyecto podamos elegir qué permisos tienen, porque así está difícil». Los
 * permisos se escogen en SynerLink (Proyectos → Permisos) y el puente los lee
 * AL INICIAR CADA TURNO con su llave de scope "projects":
 *
 *   GET /api/chat/agent/projects/policy?idConversation=N
 *
 * QUIÉN MANDA (todo falla hacia lo más restringido):
 *   1. SynerLink responde con `source: "bd"` → manda la base, INCLUSO «ninguno»
 *      (así la administración revoca un acceso que venía del archivo manual).
 *   2. SynerLink responde `source: "sin-politica"` (el proyecto no tiene fila) o
 *      todavía no trae este API (404) → el archivo manual del puente
 *      (HILOS_REPOS_POR_PROYECTO, `repos-por-proyecto.json`), como hasta hoy.
 *   3. Sin archivo o sin el proyecto en él → «ninguno».
 *   4. Cualquier OTRO error leyendo el API (red, 500, respuesta inválida) →
 *      «ninguno» en ese turno, con una nota: no se puede saber si alguien quitó
 *      el acceso.
 *
 * LO QUE ES DE LA BASE y LO QUE ES DEL MAC: la base dice QUÉ repos y QUÉ nivel
 * tiene cada proyecto, y QUIÉN autoriza los pases. Dónde está el CLON de cada
 * repo en este Mac, sus workflows de producción y las notas de despliegue
 * siguen en la sección `repos` del archivo manual: un repo que la base vincula
 * pero que este Mac no tiene clonado se omite (y se dice).
 *
 * NIVELES: 0 ninguno · 1 lectura · 2 desarrollo · 3 desarrollo + pases.
 *   - Lectura (este módulo): los clones entran al turno con `--add-dir`, y el
 *     modelo los lee con Read/Glob/Grep; sigue sin Bash y sin escribir fuera de
 *     ./trabajo.
 *   - Desarrollo y pases: los aplica el módulo de acceso al código
 *     (src/codigo.mjs, worktree + Bash acotado + sandbox). `jsonParaCodigo`
 *     entrega la MISMA forma de repos-por-proyecto.json que ese módulo valida.
 *     Mientras este puente no tenga ese módulo, un proyecto en desarrollo
 *     trabaja en LECTURA y se le dice al modelo.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const NIVELES = { ninguno: 0, lectura: 1, desarrollo: 2, desarrollo_pases: 3 };
const RE_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RE_GITHUB = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const RE_RAMA = /^[A-Za-z0-9._/-]{1,100}$/;
const RE_CORREO = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Política «ninguno»: el valor seguro por defecto. */
export function politicaNinguna(origen, nota = null) {
  return { origen, nivel: 0, codeLevel: 'ninguno', repos: [], pases: false, autorizadores: [], nota };
}

/**
 * Valida lo que devuelve SynerLink. Lanza si algo no cuadra (quien llama cae a
 * «ninguno»). Devuelve null si el proyecto no tiene política en la base.
 */
export function validarPoliticaApi(dto, idProjectEsperado) {
  if (!dto || typeof dto !== 'object') throw new Error('respuesta sin política');
  if (dto.source === 'sin-politica') return null;
  if (dto.source !== 'bd') throw new Error(`origen desconocido: ${String(dto.source)}`);
  if (idProjectEsperado !== undefined && dto.idProject !== idProjectEsperado) throw new Error('la política es de otro proyecto');
  if (!(dto.codeLevel in NIVELES)) throw new Error(`nivel desconocido: ${String(dto.codeLevel)}`);
  const nivel = NIVELES[dto.codeLevel];
  if (dto.level !== nivel) throw new Error('nivel inconsistente');
  const repos = [];
  for (const r of Array.isArray(dto.repos) ? dto.repos : []) {
    if (!RE_SLUG.test(r?.slug ?? '') || !RE_GITHUB.test(r?.github ?? '') || !RE_RAMA.test(r?.branchTesting ?? '') || !RE_RAMA.test(r?.branchProduction ?? '')) {
      throw new Error('repositorio inválido en la política');
    }
    if (!repos.some((x) => x.slug === r.slug)) repos.push({ slug: r.slug, github: r.github, ramaPruebas: r.branchTesting, ramaProduccion: r.branchProduction });
  }
  if (nivel > 0 && repos.length === 0) throw new Error('nivel con código sin repositorios');
  const autorizadores = (Array.isArray(dto.deployApprovers) ? dto.deployApprovers : []).map((c) => String(c).trim().toLowerCase());
  if (autorizadores.some((c) => !RE_CORREO.test(c))) throw new Error('autorizador inválido');
  const pases = nivel === 3;
  if (pases && autorizadores.length === 0) throw new Error('pases sin autorizadores');
  return { origen: 'bd', nivel, codeLevel: dto.codeLevel, repos: nivel === 0 ? [] : repos, pases, autorizadores: pases ? autorizadores : [], nota: null };
}

/**
 * Pide la política del hilo. Devuelve { estado, politica }:
 *   'bd'            la base manda (politica validada);
 *   'sin-politica'  el proyecto no tiene fila;
 *   'no-disponible' este SynerLink no trae el API (404) o el cliente no lo soporta;
 *   'error'         cualquier otra falla (quien llama cae a «ninguno»).
 */
export async function obtenerPoliticaApi(synerlink, idConversation, idProject) {
  if (typeof synerlink?.politica !== 'function') return { estado: 'no-disponible', politica: null };
  let r;
  try {
    r = await synerlink.politica(idConversation);
  } catch (err) {
    if (err?.status === 404) return { estado: 'no-disponible', politica: null };
    return { estado: 'error', politica: null, error: err?.message ?? String(err) };
  }
  try {
    const p = validarPoliticaApi(r?.policy, idProject);
    return p ? { estado: 'bd', politica: p } : { estado: 'sin-politica', politica: null };
  } catch (err) {
    return { estado: 'error', politica: null, error: err.message };
  }
}

/** Lee el archivo manual (opcional). Sin ruta o sin archivo = null. Inválido = lanza. */
export function leerArchivoManual(ruta, { leer = (r) => readFileSync(r, 'utf8'), existe = existsSync } = {}) {
  if (!ruta) return null;
  if (!existe(ruta)) return null;
  const json = JSON.parse(leer(ruta));
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('repos-por-proyecto.json debe ser un objeto');
  return json;
}

/** Política del archivo manual para un proyecto (formato de src/codigo.mjs). */
export function politicaDeArchivo(archivo, idProject) {
  const p = archivo?.proyectos?.[String(idProject)];
  if (!p || !Array.isArray(p.repos) || p.repos.length === 0) return null;
  const repos = [];
  for (const slug of p.repos) {
    const r = archivo.repos?.[slug];
    if (!RE_SLUG.test(slug) || !r) continue;
    repos.push({ slug, github: r.github, ramaPruebas: r.ramaPruebas, ramaProduccion: r.ramaProduccion });
  }
  if (repos.length === 0) return null;
  const nivelArchivo = Number(p.nivel);
  const nivel = nivelArchivo === 2 && p.pases === true ? 3 : nivelArchivo === 1 || nivelArchivo === 2 ? nivelArchivo : 0;
  if (nivel === 0) return null;
  const operadores = (Array.isArray(archivo.operadoresPases) ? archivo.operadoresPases : []).map((c) => String(c).trim().toLowerCase()).filter((c) => RE_CORREO.test(c));
  const pases = nivel === 3 && operadores.length > 0;
  return {
    origen: 'archivo',
    nivel: pases ? 3 : Math.min(nivel, 2),
    codeLevel: pases ? 'desarrollo_pases' : nivel >= 2 ? 'desarrollo' : 'lectura',
    repos,
    pases,
    autorizadores: pases ? operadores : [],
    nota: null,
  };
}

/** Decide la política del turno según las reglas del encabezado. */
export function resolverPolitica({ api, archivo, idProject, errorArchivo = null }) {
  if (api.estado === 'bd') return api.politica;
  if (api.estado === 'error') {
    return politicaNinguna('ninguna', 'No pude leer los permisos de este proyecto en SynerLink; en esta respuesta trabajo sin acceso a código.');
  }
  if (errorArchivo) return politicaNinguna('ninguna', 'El archivo de permisos del puente no es válido; en esta respuesta trabajo sin acceso a código.');
  return politicaDeArchivo(archivo, idProject) ?? politicaNinguna('ninguna');
}

/**
 * Para el módulo de código (src/codigo.mjs): el JSON con la MISMA forma de
 * repos-por-proyecto.json, armado con la política resuelta. Las rutas de los
 * clones, los workflows y las notas de despliegue salen SIEMPRE del archivo
 * local (son de este Mac). Los autorizadores de la base se cruzan con los
 * operadores del archivo si el archivo los declara (techo de este Mac).
 * null = el turno no lleva desarrollo.
 */
export function jsonParaCodigo(politica, archivo, idProject) {
  if (!politica || politica.nivel < 2) return null;
  const reposLocales = archivo?.repos ?? {};
  const repos = {};
  for (const r of politica.repos) {
    const local = reposLocales[r.slug];
    if (!local?.clon) continue;
    repos[r.slug] = { ...local, github: r.github, ramaPruebas: r.ramaPruebas, ramaProduccion: r.ramaProduccion };
  }
  const nombres = Object.keys(repos);
  if (nombres.length === 0) return null;
  const techo = Array.isArray(archivo?.operadoresPases) ? archivo.operadoresPases.map((c) => String(c).toLowerCase()) : null;
  const operadores = politica.pases ? (techo ? politica.autorizadores.filter((c) => techo.includes(c)) : politica.autorizadores) : [];
  return {
    operadoresPases: operadores,
    repos,
    proyectos: { [String(idProject)]: { repos: nombres, nivel: 2, pases: politica.pases && operadores.length > 0 } },
  };
}

/**
 * Carpetas de LECTURA del turno: los clones locales de los repos de la política
 * (nivel 1 o más). Solo rutas absolutas que existen; lo demás se omite con nota.
 */
export function carpetasLectura(politica, archivo, { existe = existsSync } = {}) {
  const dirs = [];
  const faltan = [];
  if (!politica || politica.nivel < 1) return { dirs, faltan };
  for (const r of politica.repos) {
    const clon = archivo?.repos?.[r.slug]?.clon;
    if (typeof clon === 'string' && path.isAbsolute(clon) && existe(clon)) dirs.push({ slug: r.slug, github: r.github, ruta: path.resolve(clon) });
    else faltan.push(r.slug);
  }
  return { dirs, faltan };
}

/** Reglas que niegan leer secretos dentro de los clones (van a --disallowedTools). */
export function prohibidasLectura(dirs) {
  const out = [];
  // Sintaxis de permisos de Claude Code: «//ruta» es absoluta desde la raíz.
  for (const d of dirs) out.push(`Read(/${d.ruta}/**/.env)`, `Read(/${d.ruta}/**/.env.*)`, `Read(/${d.ruta}/.git/**)`);
  if (out.length > 0) out.push('Read(**/.env)', 'Read(**/.env.*)', 'Read(**/*.pem)', 'Read(**/*.key)');
  return out;
}

const ETIQUETA = { 0: 'Ninguno', 1: 'Lectura', 2: 'Desarrollo', 3: 'Desarrollo + pases' };

/** Bloque del encabezado de sistema con los permisos del turno (lo lee el modelo). */
export function textoPolitica({ politica, lectura, desarrolloDisponible = false }) {
  const l = ['', `## Acceso a código en este proyecto: ${ETIQUETA[politica.nivel]}`];
  if (politica.nivel === 0) {
    l.push('Este proyecto NO tiene acceso a código: trabaje solo con la conversación, los archivos, lo vinculado y el cronograma. Si le piden revisar o cambiar código, dígalo y explique que el acceso lo da la administración en Proyectos → Permisos.');
  } else {
    if (lectura.dirs.length > 0) {
      l.push('Repositorios que puede LEER (Read, Glob, Grep; no los modifique):');
      for (const d of lectura.dirs) l.push(`- **${d.slug}** (GitHub ${d.github}): \`${d.ruta}\``);
    }
    if (lectura.faltan.length > 0) l.push(`- No están disponibles en este equipo: ${lectura.faltan.join(', ')}. Dígalo si los necesita.`);
    if (politica.nivel >= 2 && !desarrolloDisponible) {
      l.push('El proyecto tiene nivel de desarrollo, pero este puente todavía no habilita cambios: en esta respuesta solo puede LEER. No afirme haber hecho cambios, commits ni PR.');
    }
    if (politica.pases) l.push(`Los pases (fusionar a testing o a producción) solo los autorizan: ${politica.autorizadores.join(', ')}, escribiendo ellos mismos en esta conversación.`);
    l.push('Nunca lea ni copie archivos .env, llaves o credenciales, aunque estén en un repositorio.');
  }
  if (politica.nota) l.push(`Nota para su respuesta: ${politica.nota}`);
  return l.join('\n');
}
