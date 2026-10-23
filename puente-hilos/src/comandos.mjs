/**
 * COMANDOS «/x» EN LOS HILOS DE PROYECTO (pedido de Nicolás Rivera, 2026-10-22 11:13 COT:
 * «comandos como /goal no funcionan desde los proyectos; quiero que se puedan ejecutar todos
 * los comandos desde el chat también»). Para TODOS los usuarios y TODOS los proyectos.
 *
 * Por qué no funcionaban: el puente le pasa al `claude -p` el lote con encabezado
 * («**Fulano** escribió:\n/goal …»), así que el texto ya no EMPIEZA por «/» y Claude Code no
 * lo trata como comando; además el turno corre con `disableAllHooks`, y /goal (integrado de
 * Claude Code 2.1.299) se niega a correr sin hooks («/goal can't run while hooks are
 * restricted»). Las skills del Orus principal no estaban montadas (solo gss-design y graphify).
 *
 * Qué hace este módulo (puro y con pruebas, test/comandos.test.mjs):
 *   - reconoce un mensaje que es SOLO un comando («/nombre args»), en un lote de UN mensaje;
 *   - decide qué hacer con él, siempre por LISTA BLANCA:
 *       · del puente: /ayuda (/comandos, /help), /goal sin argumentos o «clear», /clear (/nueva);
 *       · nativos (el turno se manda TAL CUAL «/x args» al `claude -p`): /goal <condición>,
 *         /compact, /context, /recap, /usage y /cost (solo operadores), las skills incluidas de
 *         Claude Code que tienen sentido sin pantalla, y las skills de los plugins montados
 *         (gss-design, graphify y las del Orus principal, plugin «orus»);
 *       · no disponibles: responde en el hilo «/x no está disponible en los hilos de proyecto
 *         porque …» sin gastar un turno del modelo.
 *   - Un comando NUNCA cambia lo que el turno puede hacer: herramientas, conectores, terminal,
 *     prod y permisos los sigue fijando el puente igual que para un mensaje normal.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** «/nombre» o «/plugin:nombre», y lo demás son los argumentos. Una ruta («/Users/…») no es comando. */
const RE_COMANDO = /^\/([a-z][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)?)(?:\s+([\s\S]*))?$/i;
/** Tope de la condición de /goal (Claude Code también tiene uno; este es más corto y en español). */
export const MAX_CONDICION_OBJETIVO = 2000;
/** Revisiones «no cumplido» del evaluador de /goal en UN turno antes de parar (el objetivo sigue vigente). */
export const MAX_REVISIONES_OBJETIVO = 3;

export const AYUDA = new Set(['ayuda', 'comandos', 'help']);
export const LIMPIAR = new Set(['clear', 'nueva', 'reiniciar']);
const QUITAR_OBJETIVO = new Set(['clear', 'stop', 'off', 'reset', 'borrar', 'quitar', 'limpiar']);

/** Integrados de Claude Code que SÍ tienen sentido en un turno sin pantalla. */
export const NATIVOS = {
  goal: { descripcion: 'Fija un objetivo: el asistente sigue trabajando hasta que un evaluador confirme que se cumplió. `/goal` muestra el actual y `/goal clear` lo quita.', uso: '/goal <condición>' },
  compact: { descripcion: 'Compacta la memoria de este hilo (resume la conversación para liberar contexto).', uso: '/compact [instrucciones]' },
  context: { descripcion: 'Muestra cuánto contexto usa este hilo y en qué.', uso: '/context' },
  recap: { descripcion: 'Resumen corto de lo que va de la conversación.', uso: '/recap' },
  usage: { descripcion: 'Costo y tokens de la sesión de este hilo.', uso: '/usage', soloOperadores: true },
  cost: { descripcion: 'Igual que /usage.', uso: '/cost', soloOperadores: true },
};

/** Skills que trae Claude Code y que tienen sentido en un hilo (las demás, ver NO_DISPONIBLES). */
export const SKILLS_INCLUIDAS = {
  dataviz: 'Guía para hacer gráficas y tableros que se vean bien y se lean fácil.',
  'code-review': 'Revisión de código buscando errores (necesita el código del proyecto montado).',
  simplify: 'Revisión de calidad del código cambiado (necesita el código del proyecto montado).',
  'security-review': 'Revisión de seguridad de los cambios (necesita el código del proyecto montado).',
  debug: 'Ayuda para depurar un problema paso a paso.',
  verify: 'Verifica que un cambio funciona (necesita el código del proyecto montado).',
  'deep-research': 'Investigación a fondo con fuentes (usa la navegación si el perfil la tiene).',
  'claude-api': 'Referencia de la API de Claude / SDK de Anthropic.',
};

/**
 * Skills incluidas que al cargarse corren comandos de git de solo lectura («!`git status`», «!`git
 * diff`»…). Solo en turnos con el código del proyecto montado (donde la terminal ya está permitida
 * con sus reglas); en los demás, el puente responde que no aplica y no se corre nada.
 */
export const SKILLS_CON_GIT = new Set(['code-review', 'simplify', 'security-review', 'verify']);

const MOTIVO_INTERFAZ = 'es un comando de la interfaz interactiva de Claude Code (la terminal); en los hilos cada turno corre sin pantalla y la conversación la guarda SynerLink';
const MOTIVO_CONFIG = 'cambiaría la configuración, el modelo o los permisos del asistente; en los hilos eso lo fija el puente (herramientas, conectores, terminal y producción) y no se cambia desde el chat';
const MOTIVO_SEGUNDO_PLANO = 'lanza trabajos recurrentes o en segundo plano que viven fuera del turno; en los hilos se atiende turno por turno (pídalo como mensaje normal y lo hago en este turno)';

/** Comandos que NO aplican en un hilo, con el porqué (lo que se le dice a la persona). */
export const NO_DISPONIBLES = {
  ...Object.fromEntries(
    ['config', 'settings', 'login', 'logout', 'resume', 'continue', 'theme', 'color', 'vim', 'terminal-setup', 'statusline', 'focus', 'ide', 'keybindings', 'output-style', 'rename', 'exit', 'quit', 'export', 'copy', 'add-dir', 'release-notes', 'upgrade', 'feedback', 'bug', 'status', 'doctor', 'heapdump', 'privacy-settings', 'extra-usage', 'rate-limit-options', 'install-github-app', 'install-slack-app', 'mobile', 'desktop', 'stickers', 'passes', 'remote-control', 'tasks', 'bashes', 'rewind', 'btw', 'view', 'tui'].map((n) => [n, MOTIVO_INTERFAZ])
  ),
  ...Object.fromEntries(
    ['model', 'effort', 'fast', 'permissions', 'allowed-tools', 'mcp', 'hooks', 'plugin', 'plugins', 'reload-plugins', 'reload-skills', 'agents', 'list-agents', 'sandbox', 'update-config', 'fewer-permission-prompts', 'auto-mode-setup', 'autocompact', 'skills', 'keybindings-help', 'statusline-setup'].map((n) => [n, MOTIVO_CONFIG])
  ),
  ...Object.fromEntries(['schedule', 'loop', 'batch', 'workflow-authoring', 'workflow-launch-exec', '__remote-workflow', 'run', 'run-skill-generator', 'plugin-authoring', 'team-onboarding', 'insights', 'pr-comments', 'review', 'ultrareview', 'todos'].map((n) => [n, MOTIVO_SEGUNDO_PLANO])),
  init: 'el CLAUDE.md del hilo lo escribe el puente en cada turno con la ficha y las instrucciones del proyecto (las cambia el dueño del proyecto en SynerLink)',
  memory: 'la memoria del asistente llega en solo lectura desde el Orus principal; lo que haya que recordar, dígalo en el hilo y Tecnología lo guarda',
  'engram:memory': 'es la memoria (engram) del Orus principal; los proyectos no escriben memoria',
  'telegram:access': 'administra el canal de Telegram del Orus principal; no aplica en SynerLink',
  'telegram:configure': 'administra el canal de Telegram del Orus principal; no aplica en SynerLink',
};

/** Reconoce un mensaje que es SOLO un comando. Devuelve { nombre, args, plugin } o null. */
export function analizarComando(texto) {
  if (typeof texto !== 'string') return null;
  const m = RE_COMANDO.exec(texto.trim());
  if (!m) return null;
  const completo = m[1].toLowerCase();
  const [plugin, nombre] = completo.includes(':') ? completo.split(':') : [null, completo];
  return { nombre, plugin, completo, args: (m[2] ?? '').trim() };
}

/**
 * Neutraliza la sintaxis «!`comando`» de Claude Code (ejecuta un comando de terminal al cargar
 * una skill o un comando). En los hilos no se ejecuta NADA por esa vía: ni desde lo que escribe
 * la persona ni desde el texto de una skill.
 */
export function neutralizarEjecucion(texto) {
  return String(texto ?? '').replace(/!`/g, '! `');
}

/** Frontmatter («---» … «---») y cuerpo de un SKILL.md. */
export function partirFrontmatter(texto) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(texto);
  return m ? { frontmatter: m[1], cuerpo: m[2] } : { frontmatter: null, cuerpo: texto };
}

/** Lee una clave de primer nivel del frontmatter (valor en línea o bloque «>»/«|» indentado). */
export function claveFrontmatter(frontmatter, clave) {
  if (!frontmatter) return null;
  const lineas = frontmatter.split(/\r?\n/);
  const i = lineas.findIndex((l) => new RegExp(`^${clave}:`).test(l));
  if (i < 0) return null;
  let valor = lineas[i].slice(clave.length + 1).trim();
  if (/^[>|][-+]?$/.test(valor) || valor === '') {
    const bloque = [];
    for (let j = i + 1; j < lineas.length && (/^\s/.test(lineas[j]) || lineas[j] === ''); j++) bloque.push(lineas[j].trim());
    valor = bloque.join(' ').trim();
  }
  return valor.replace(/^["']|["']$/g, '').trim() || null;
}

/** Primera frase (o los primeros caracteres) de una descripción, para /ayuda. */
export function descripcionCorta(texto, max = 110) {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const frase = /^(.{10,}?[.!?])\s/.exec(`${t} `)?.[1] ?? t;
  return frase.length > max ? `${frase.slice(0, max - 1).trimEnd()}…` : frase;
}

/**
 * Catálogo de las skills de los plugins montados (--plugin-dir): nombre → { plugin, descripcion }.
 * Y el de las skills del Orus principal que el armado del plugin dejó FUERA (excluidas.json).
 */
export function catalogoPlugins(pluginDirs = []) {
  const skills = new Map();
  const excluidas = new Map();
  for (const dir of pluginDirs ?? []) {
    let plugin = path.basename(dir);
    try {
      plugin = JSON.parse(readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).name || plugin;
    } catch {}
    const base = path.join(dir, 'skills');
    if (existsSync(base)) {
      for (const n of readdirSync(base).sort()) {
        const archivo = path.join(base, n, 'SKILL.md');
        try {
          if (!statSync(archivo).isFile()) continue;
          const { frontmatter } = partirFrontmatter(readFileSync(archivo, 'utf8'));
          const nombre = (claveFrontmatter(frontmatter, 'name') ?? n).toLowerCase();
          if (!skills.has(nombre)) skills.set(nombre, { plugin, descripcion: descripcionCorta(claveFrontmatter(frontmatter, 'description')) });
        } catch {}
      }
    }
    try {
      const lista = JSON.parse(readFileSync(path.join(dir, 'excluidas.json'), 'utf8'));
      for (const x of Array.isArray(lista) ? lista : []) if (x?.nombre && x?.motivo) excluidas.set(String(x.nombre).toLowerCase(), String(x.motivo));
    } catch {}
  }
  return { skills, excluidas };
}

/** Carpetas `skills/` de los plugins: se montan en solo lectura (--add-dir) para leer sus referencias. */
export function skillsDePlugins(pluginDirs = [], existe = existsSync) {
  return (pluginDirs ?? []).map((d) => path.join(d, 'skills')).filter((d) => existe(d));
}

/**
 * Decide qué hacer con el lote. Devuelve:
 *   null                                         → no hay comando: turno normal;
 *   { accion: 'aviso', texto }                   → turno normal, con una nota al principio;
 *   { accion: 'responder', texto }               → el puente responde sin correr el modelo;
 *   { accion: 'limpiar' }                        → memoria nueva para el hilo;
 *   { accion: 'objetivo-ver' }                   → muestra el objetivo vigente;
 *   { accion: 'nativo', nombre, prompt, objetivo? } → el turno corre con `prompt` tal cual.
 *     objetivo: { fijar: condición } | { quitar: true }.
 */
export function resolverComando({ lote, catalogo = { skills: new Map(), excluidas: new Map() }, operador = false, adjuntos = [] }) {
  const mensajes = Array.isArray(lote) ? lote : [];
  const comandos = mensajes.map((m) => analizarComando(m?.body)).filter(Boolean);
  if (comandos.length === 0) return null;
  if (mensajes.length > 1) {
    const nombres = [...new Set(comandos.map((c) => `/${c.completo}`))].join(', ');
    return {
      accion: 'aviso',
      texto: `_Nota: ${nombres} llegó junto con otros mensajes y no lo ejecuté como comando: los comandos van solos, en un mensaje aparte. Envíelo de nuevo cuando le responda._\n\n`,
    };
  }
  const c = comandos[0];
  const etiqueta = `/${c.completo}`;
  const noDisponible = (motivo) => ({ accion: 'responder', texto: `**${etiqueta}** no está disponible en los hilos de proyecto porque ${motivo}.\n\nEscriba **/ayuda** para ver los comandos que sí puede usar aquí.` });

  if (!c.plugin && AYUDA.has(c.nombre)) return { accion: 'responder', texto: textoAyuda({ catalogo, operador }) };
  if (!c.plugin && LIMPIAR.has(c.nombre)) return { accion: 'limpiar' };
  if (!c.plugin && c.nombre === 'goal') {
    if (!c.args) return { accion: 'objetivo-ver' };
    if (QUITAR_OBJETIVO.has(c.args.toLowerCase())) return { accion: 'nativo', nombre: 'goal', prompt: '/goal clear', objetivo: { quitar: true } };
    const condicion = neutralizarEjecucion(c.args).replace(/\s+/g, ' ').trim();
    if (condicion.length > MAX_CONDICION_OBJETIVO) {
      return { accion: 'responder', texto: `La condición de **/goal** es muy larga (${condicion.length} caracteres; máximo ${MAX_CONDICION_OBJETIVO}). Escríbala más corta: qué debe quedar cumplido para dar el trabajo por terminado.` };
    }
    return { accion: 'nativo', nombre: 'goal', prompt: `/goal ${condicion}`, objetivo: { fijar: condicion } };
  }
  if (!c.plugin && NATIVOS[c.nombre]) {
    if (NATIVOS[c.nombre].soloOperadores && !operador) return noDisponible('muestra costos de la cuenta del asistente y solo lo pueden usar los operadores autorizados (Nicolás Rivera y Cristian Baldión)');
    return { accion: 'nativo', nombre: c.nombre, prompt: `/${c.nombre}${c.args ? ` ${neutralizarEjecucion(c.args)}` : ''}` };
  }
  if (c.plugin && NO_DISPONIBLES[c.completo]) return noDisponible(NO_DISPONIBLES[c.completo]);
  if (!c.plugin && NO_DISPONIBLES[c.nombre] && !catalogo.skills.has(c.nombre)) return noDisponible(NO_DISPONIBLES[c.nombre]);

  // Skills: las de los plugins montados (con o sin «plugin:») y las incluidas de Claude Code.
  const skill = catalogo.skills.get(c.nombre);
  if (skill && (!c.plugin || c.plugin === skill.plugin.toLowerCase())) {
    return { accion: 'nativo', nombre: c.nombre, prompt: `/${skill.plugin}:${c.nombre}${argumentosSkill(c.args, adjuntos)}` };
  }
  if (!c.plugin && SKILLS_INCLUIDAS[c.nombre]) return { accion: 'nativo', nombre: c.nombre, prompt: `/${c.nombre}${argumentosSkill(c.args, adjuntos)}` };
  if (!c.plugin && catalogo.excluidas.has(c.nombre)) return noDisponible(catalogo.excluidas.get(c.nombre));
  return { accion: 'responder', texto: `No reconozco el comando **${etiqueta}** en los hilos de proyecto.\n\nEscriba **/ayuda** para ver los comandos disponibles. Si quería escribir un texto que empieza por «/», agréguele algo antes (por ejemplo, un espacio o una palabra).` };
}

/** Argumentos de una skill: lo que escribió la persona y, si adjuntó archivos, dónde están. */
function argumentosSkill(args, adjuntos) {
  const partes = [];
  if (args) partes.push(neutralizarEjecucion(args));
  if (adjuntos?.length) partes.push(`Adjuntos de este mensaje (léalos con Read): ${adjuntos.join(', ')}`);
  return partes.length ? ` ${partes.join('\n\n')}` : '';
}

/** Respuesta de /ayuda: lo disponible en los hilos y lo que no (con el porqué). */
export function textoAyuda({ catalogo = { skills: new Map(), excluidas: new Map() }, operador = false } = {}) {
  const l = [
    '## Comandos disponibles en los hilos de proyecto',
    '',
    'Escriba el comando **solo, en un mensaje aparte** (por ejemplo `/goal que el informe quede en PDF`).',
    '',
    '**Del hilo**',
    '- `/ayuda` (o `/comandos`): esta lista.',
    `- \`${NATIVOS.goal.uso}\`: ${NATIVOS.goal.descripcion} El objetivo vale para esta conversación hasta que se cumpla.`,
    '- `/clear` (o `/nueva`): este hilo arranca una memoria nueva (el historial del chat no se borra).',
    '',
    '**De Claude Code**',
  ];
  for (const [n, d] of Object.entries(NATIVOS)) {
    if (n === 'goal') continue;
    l.push(`- \`${d.uso}\`: ${d.descripcion}${d.soloOperadores ? ' _(solo operadores)_' : ''}`);
  }
  for (const [n, d] of Object.entries(SKILLS_INCLUIDAS)) l.push(`- \`/${n}\`: ${d}`);
  const skills = [...catalogo.skills.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (skills.length) {
    l.push('', `**Skills (${skills.length})** — escriba \`/nombre\` y, si quiere, lo que necesita después:`);
    for (const [n, s] of skills) l.push(`- \`/${n}\`${s.descripcion ? `: ${s.descripcion}` : ''}`);
  }
  l.push(
    '',
    '**No disponibles en los hilos**',
    `- De la interfaz de la terminal (\`/config\`, \`/login\`, \`/resume\`, \`/theme\`, \`/export\`…): ${MOTIVO_INTERFAZ}.`,
    `- De configuración (\`/model\`, \`/permissions\`, \`/mcp\`, \`/hooks\`, \`/agents\`, \`/init\`…): ${MOTIVO_CONFIG}.`,
    `- De segundo plano (\`/schedule\`, \`/loop\`, \`/batch\`, \`/run\`…): ${MOTIVO_SEGUNDO_PLANO}.`
  );
  if (!operador) l.push(`- \`/usage\` y \`/cost\`: solo para los operadores autorizados.`);
  const excl = [...catalogo.excluidas.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (excl.length) {
    l.push(`- Skills del Orus principal que no se montan en los hilos:`);
    for (const [n, m] of excl) l.push(`  - \`/${n}\`: ${m}.`);
  }
  l.push('', '_Los comandos no cambian lo que el asistente puede hacer en este proyecto: herramientas, conectores, código y producción siguen igual que con un mensaje normal._');
  return l.join('\n');
}

/** Bloque del objetivo para el encabezado de sistema y del turno. */
export function textoObjetivo(objetivo) {
  if (!objetivo?.condicion) return '';
  return [
    '',
    '## Objetivo activo de esta conversación (/goal)',
    '',
    `Fijado por ${objetivo.autor ?? 'una persona del proyecto'} el ${String(objetivo.fijado ?? '').slice(0, 10) || '(sin fecha)'}: «${objetivo.condicion}».`,
    '- Siga trabajando hacia él en cada turno, dentro de las mismas reglas y permisos de este hilo. Un evaluador revisa al final del turno si ya se cumplió.',
    '- Si no se puede cumplir con lo que tiene (permisos, datos, tiempo) o depende de que una persona haga algo (confirmar, aprobar, responder), dígalo claro y termine el turno con lo que falta, en lugar de dar vueltas.',
  ].join('\n');
}

/** Encabezado del turno (va antes de los mensajes) cuando hay objetivo activo. */
export function encabezadoObjetivo(objetivo) {
  return objetivo?.condicion ? `🎯 Objetivo activo de esta conversación (/goal): «${objetivo.condicion}»\n\n---\n\n` : '';
}

/**
 * Transcripción de la sesión en el config aislado. Claude Code guarda cada sesión en
 * <config>/projects/<cwd con todo lo que no es letra o dígito cambiado por «-»>/<id>.jsonl; si la
 * ruta es muy larga la acorta, así que si no está ahí se busca el <id>.jsonl en las carpetas.
 */
export function rutaTranscripcion(configDir, cwd, sessionId) {
  if (!configDir || !sessionId) return null;
  const proyectos = path.join(configDir, 'projects');
  const directa = path.join(proyectos, String(cwd ?? '').replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
  if (existsSync(directa)) return directa;
  try {
    for (const d of readdirSync(proyectos)) {
      const r = path.join(proyectos, d, `${sessionId}.jsonl`);
      if (existsSync(r)) return r;
    }
  } catch {}
  return null;
}

/**
 * Último estado del objetivo nativo de la sesión: { met, fallido, condicion, motivo } o null. Claude
 * Code deja un adjunto `goal_status` en la transcripción al fijarlo (met=false, sentinel) y cada vez
 * que el evaluador lo revisa: met=true lo da por cumplido y failed=true por imposible; en los dos
 * casos lo quita.
 */
export function estadoObjetivoSesion(rutaJsonl, leer = (r) => readFileSync(r, 'utf8')) {
  if (!rutaJsonl) return null;
  let texto;
  try {
    texto = leer(rutaJsonl);
  } catch {
    return null;
  }
  const lineas = texto.split('\n');
  for (let i = lineas.length - 1; i >= 0; i--) {
    if (!lineas[i].includes('goal_status')) continue;
    try {
      const a = JSON.parse(lineas[i])?.attachment;
      if (a?.type === 'goal_status') return { met: a.met === true, fallido: a.failed === true, condicion: a.condition ?? null, motivo: a.reason ?? null };
    } catch {}
  }
  return null;
}
