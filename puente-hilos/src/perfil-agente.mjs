/**
 * PERFIL DEL AGENTE: «desarrollo» o «negocio» (2026-10-26).
 *
 * Pedido de Nicolás Rivera (2026-10-26 16:11 COT), sobre el proyecto 9 de producción
 * («Importaciones LATAM» / «Comercio Exterior LATAM», agente Play): «Play no es un agente de
 * desarrollo, es más para comercio exterior; igual le aparecían temas de repositorios y nada que
 * ver con lo que hacía». Regla general para todos (feedback-proyectos-regla-general-todos): vale
 * para cualquier agente o proyecto que no sea de desarrollo, no solo para Play.
 *
 *   HILOS_PERFIL=desarrollo (por defecto, para no cambiar a Orus ni a Pedro): todo como antes; el
 *     código solo entra si el proyecto tiene repos vinculados (repos-por-proyecto.json / permisos).
 *   HILOS_PERFIL=negocio: el contexto de código NO se activa NUNCA, aunque el proyecto tenga repos
 *     vinculados (por ejemplo, escogidos por error en la pantalla de Permisos al crear el proyecto):
 *       - sin carpeta codigo/, worktrees, token de GitHub, terminal ni permisos de escritura en código;
 *       - sin índice de repos, sin guía del flujo de desarrollo y sin grafos de Graphify;
 *       - /ayuda no ofrece las skills de revisión de código (/code-review, /simplify,
 *         /security-review, /verify, /claude-api) y, si se piden, el puente explica por qué no;
 *       - el bloque de memoria no habla de ramas, pases ni servidores;
 *       - el encabezado de sistema lleva el ENFOQUE del agente (HILOS_ENFOQUE).
 *     La configuración rechaza HILOS_REPOS_POR_PROYECTO, HILOS_GITHUB_TOKEN_ARCHIVO y
 *     HILOS_GRAFOS_DIR con este perfil (falla al arrancar, no en silencio).
 */

export const PERFILES_AGENTE = ['desarrollo', 'negocio'];
export const PERFIL_POR_DEFECTO = 'desarrollo';
export const MAX_ENFOQUE = 400;

/** Variables de código que no tienen sentido (y se rechazan) en un puente de perfil «negocio». */
export const VARIABLES_SOLO_DESARROLLO = ['HILOS_REPOS_POR_PROYECTO', 'HILOS_GITHUB_TOKEN_ARCHIVO', 'HILOS_GRAFOS_DIR'];

/** Skills incluidas de Claude Code que solo sirven con código (no se ofrecen en «negocio»). */
export const SKILLS_SOLO_DESARROLLO = new Set(['code-review', 'simplify', 'security-review', 'verify', 'claude-api']);

export function esNegocio(cfg) {
  return cfg?.perfilAgente === 'negocio';
}

/** Motivo que ve la persona cuando pide una skill de código en un hilo de negocio. */
export function motivoSoloDesarrollo(agente = 'este asistente') {
  return `${agente} trabaja en este proyecto con perfil de negocio: no tiene código ni repositorios. Las revisiones de código las atiende el equipo de Tecnología en un proyecto de desarrollo`;
}

/** Bloque del encabezado de sistema para el perfil «negocio» (vacío en «desarrollo»). */
export function textoPerfilNegocio({ agente, enfoque = null }) {
  return [
    '',
    '## Su enfoque en este proyecto (perfil de negocio)',
    '',
    `- Usted es ${agente}, asistente de negocio${enfoque ? `: ${enfoque}` : ''}. Trabaje desde ese rol y con sus conocimientos, skills y conectores.`,
    '- Usted NO es un asistente de desarrollo de software: en este hilo no hay código, repositorios, ramas, PR, pases a testing o producción ni terminal. No los ofrezca, no los mencione como opción y no hable de ellos salvo que la persona pregunte; en ese caso diga que eso lo atiende el equipo de Tecnología en un proyecto de desarrollo.',
    '- Si la pantalla del proyecto muestra repositorios o un nivel de acceso al código, no aplican a usted: no los use ni los ofrezca.',
  ].join('\n');
}

/** Perfil para la línea «listo:» (sin secretos). */
export function perfilListo(cfg) {
  if (!esNegocio(cfg)) return 'desarrollo (código solo en proyectos con repos vinculados)';
  return `negocio (sin código ni repositorios en ningún proyecto)${cfg.enfoque ? `; enfoque: ${cfg.enfoque.slice(0, 160)}` : ''}`;
}
