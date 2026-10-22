#!/usr/bin/env node
/**
 * Arma el plugin LOCAL de solo lectura `orus` con las skills del Orus principal, para que en los
 * hilos de proyecto se puedan usar como en el chat directo («/abogado-del-diablo …»). Pedido de
 * Nicolás Rivera del 2026-10-22 11:13 COT («que se puedan ejecutar todos los comandos desde el
 * chat también»), para TODOS los usuarios y proyectos.
 *
 *   node scripts/plugin-skills-orus.mjs [--fuente ~/.horus/claude-config/skills]
 *                                       [--destino ~/.puente-hilos/plugins/orus] [--ensayo]
 *
 * Es una COPIA (no symlinks): lo que cambie en el Orus principal no entra a los hilos hasta volver
 * a correr este script. Reglas de la copia:
 *   - Se omiten gss-design y graphify (ya tienen su plugin propio) y las de EXCLUIR (con su motivo,
 *     que el hilo le dice a la persona si las pide: queda en <destino>/excluidas.json).
 *   - SKILL.md: del frontmatter quedan SOLO name, description, argument-hint, when_to_use, version,
 *     license y user-invocable. Se quitan allowed-tools, hooks, model, context, agent… (una skill no
 *     puede abrir permisos, prender hooks, cambiar el modelo ni lanzar subagentes en un hilo) y la
 *     sintaxis «!`comando`» se neutraliza (no ejecuta nada al cargarse).
 *   - Otros archivos: solo texto e imágenes/fuentes, sin carpetas de caché, git, pruebas, traspasos
 *     ni datos; nada con nombre de secreto (.env, token, llave, .db…) y nada cuyo texto parezca una
 *     credencial (mismos patrones que la memoria, memoria.mjs). Topes por archivo y por skill.
 *   - Todo queda 0444/0555. Se arma en una carpeta temporal y se cambia de un golpe; la anterior
 *     queda como <destino>.bak-<fecha>.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarSecreto } from '../src/memoria.mjs';
import { claveFrontmatter, neutralizarEjecucion, partirFrontmatter } from '../src/comandos.mjs';

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : porDefecto;
}
// (las rutas se leen al llamar al script; importarlo desde las pruebas no hace nada)
const fuente = path.resolve(arg('--fuente', path.join(homedir(), '.horus', 'claude-config', 'skills')));
const destino = path.resolve(arg('--destino', path.join(homedir(), '.puente-hilos', 'plugins', 'orus')));
const ensayo = process.argv.includes('--ensayo');
const log = (m) => console.log(`[plugin-skills-orus] ${m}`);

/** Ya tienen plugin propio en el puente. */
export const OMITIR = new Set(['gss-design', 'graphify']);

const INFRA = 'opera la infraestructura de los agentes (tokens, servicios, servidores y conectores); se hace solo desde el Orus principal con un operador autorizado';
const PROD = 'escribe directamente en producción de SynerLink, y los hilos de proyecto no tienen acceso a producción (pídaselo a Tecnología)';
/** Skills del Orus principal que NO entran a los hilos, con el porqué. */
export const EXCLUIR = {
  'migrar-agente-synerlink': INFRA,
  'cambiar-auth-token': INFRA,
  'voz-tiempo-real': INFRA,
  'auditoria-agentes-ia': 'audita permisos y credenciales de toda la flota de agentes; se hace solo desde el Orus principal con un operador autorizado',
  'crear-usuario-synerlink': PROD,
  'cierre-casos-synerlink': PROD,
  'sgc-activar-empresa': PROD,
  'find-skills': 'instala skills nuevas en el equipo del Orus principal; en los hilos las skills las monta Tecnología',
  'geo-update': 'actualiza skills instaladas en el equipo del Orus principal; en los hilos las skills las monta Tecnología',
  'obsidian-cli': 'maneja la bóveda personal de Obsidian del Orus principal, que no está en los hilos',
  'analisis-reuniones': 'guarda las reuniones en la bóveda personal y envía resúmenes por Telegram, fuera del proyecto',
};

const CLAVES_FRONTMATTER = ['name', 'description', 'argument-hint', 'when_to_use', 'version', 'license', 'user-invocable'];
const DIRS_FUERA = new Set(['.git', 'node_modules', '__pycache__', '.cache', 'cache', 'traspasos', 'agentes', 'tests', 'test', 'output', 'outputs', 'salida', 'datos', 'data', 'tmp', '.venv', 'venv', '.pytest_cache']);
const NOMBRE_SECRETO = /(^|[._-])env($|[._-])|^\.env|secret|token|credential|password|contrase|\.key$|\.pem$|\.p12$|\.pfx$|\.db$|\.sqlite|\.pyc$|\.log$/i;
const TEXTO = new Set(['.md', '.txt', '.json', '.csv', '.css', '.html', '.htm', '.svg', '.yaml', '.yml', '.py', '.mjs', '.js', '.ts', '.sql', '.sh', '.xml', '.tsv']);
const BINARIO = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.woff', '.woff2', '.ttf', '.otf']);
const MAX_TEXTO = 300_000;
const MAX_BINARIO = 1_000_000;
const MAX_SKILL = 12_000_000;

/** Frontmatter con solo las claves permitidas (cada clave con sus líneas indentadas). */
export function limpiarFrontmatter(frontmatter) {
  const lineas = frontmatter.split(/\r?\n/);
  const out = [];
  let copiando = false;
  for (const l of lineas) {
    const clave = /^([A-Za-z_][\w-]*):/.exec(l)?.[1];
    if (clave) copiando = CLAVES_FRONTMATTER.includes(clave);
    else if (!/^\s/.test(l) && l.trim() !== '') copiando = false;
    if (copiando) out.push(l);
  }
  return out.join('\n');
}

/** SKILL.md saneado: frontmatter con lista blanca y sin «!`…`». */
export function sanearSkillMd(texto) {
  const { frontmatter, cuerpo } = partirFrontmatter(texto);
  const fm = frontmatter ? `---\n${limpiarFrontmatter(frontmatter)}\n---\n` : '';
  return neutralizarEjecucion(fm + cuerpo);
}

function copiarSkill(origen, destinoSkill, reporte) {
  let bytes = statSync(path.join(destinoSkill, 'SKILL.md')).size;
  const caminar = (dir, rel) => {
    for (const n of readdirSync(dir).sort()) {
      const p = path.join(dir, n);
      const r = path.join(rel, n);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (DIRS_FUERA.has(n) || n.startsWith('.')) continue;
        caminar(p, r);
        continue;
      }
      if (!st.isFile() || r === 'SKILL.md') continue;
      const ext = path.extname(n).toLowerCase();
      // (Una hoja de estilos con «tokens» de diseño no es un secreto; su texto se revisa igual abajo.)
      if (NOMBRE_SECRETO.test(n) && ext !== '.css') { reporte.omitidos.push(`${r} (nombre de secreto)`); continue; }
      if (!TEXTO.has(ext) && !BINARIO.has(ext)) continue;
      if (st.size > (TEXTO.has(ext) ? MAX_TEXTO : MAX_BINARIO)) { reporte.omitidos.push(`${r} (grande)`); continue; }
      if (bytes + st.size > MAX_SKILL) { reporte.omitidos.push(`${r} (tope de la skill)`); continue; }
      if (TEXTO.has(ext)) {
        const secreto = buscarSecreto(readFileSync(p, 'utf8'));
        if (secreto) { reporte.omitidos.push(`${r} (parece contener un secreto: ${secreto})`); continue; }
      }
      mkdirSync(path.join(destinoSkill, rel), { recursive: true });
      cpSync(p, path.join(destinoSkill, r));
      bytes += st.size;
      reporte.archivos += 1;
    }
  };
  caminar(origen, '');
  return bytes;
}

function sellar(dir) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) sellar(p);
    else chmodSync(p, 0o444);
  }
  chmodSync(dir, 0o555);
}

function principal() {
  if (!existsSync(fuente)) throw new Error(`No existe ${fuente}.`);
  if (destino.split(path.sep).includes('claude-config')) throw new Error('El destino no puede estar dentro del config de un bot.');
  const tmp = `${destino}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
  mkdirSync(path.join(tmp, 'skills'), { recursive: true });
  const incluidas = [];
  const excluidas = [];
  for (const n of readdirSync(fuente).sort()) {
    let origen;
    try {
      origen = realpathSync(path.join(fuente, n));
      if (!statSync(origen).isDirectory()) continue;
    } catch {
      log(`⚠️ ${n}: enlace roto, se omite.`);
      continue;
    }
    if (!existsSync(path.join(origen, 'SKILL.md'))) continue;
    if (OMITIR.has(n)) { log(`· ${n}: ya tiene plugin propio en el puente.`); continue; }
    if (EXCLUIR[n]) { excluidas.push({ nombre: n, motivo: EXCLUIR[n] }); log(`✗ ${n}: excluida (${EXCLUIR[n].slice(0, 60)}…)`); continue; }
    const skillMd = readFileSync(path.join(origen, 'SKILL.md'), 'utf8');
    const secreto = buscarSecreto(skillMd);
    if (secreto) {
      excluidas.push({ nombre: n, motivo: 'su texto parece contener una credencial y no se copia a los hilos (Tecnología la revisa)' });
      log(`✗ ${n}: SKILL.md parece contener un secreto (${secreto}); excluida.`);
      continue;
    }
    const nombre = (claveFrontmatter(partirFrontmatter(skillMd).frontmatter, 'name') ?? n).toLowerCase();
    if (nombre !== n) log(`⚠️ ${n}: el frontmatter dice name=${nombre}; se invoca como /${nombre}.`);
    const d = path.join(tmp, 'skills', n);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 'SKILL.md'), sanearSkillMd(skillMd));
    const reporte = { archivos: 1, omitidos: [] };
    const bytes = copiarSkill(origen, d, reporte);
    incluidas.push({ nombre: n, archivos: reporte.archivos, kb: Math.round(bytes / 1024), omitidos: reporte.omitidos.length });
    log(`✓ ${n}: ${reporte.archivos} archivo(s), ${Math.round(bytes / 1024)} KB${reporte.omitidos.length ? `; omitidos ${reporte.omitidos.length}: ${reporte.omitidos.slice(0, 3).join(', ')}${reporte.omitidos.length > 3 ? '…' : ''}` : ''}`);
  }
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  writeFileSync(
    path.join(tmp, '.claude-plugin', 'plugin.json'),
    `${JSON.stringify({ name: 'orus', version: `1.0.0-gss.${fecha}`, description: 'Skills del Orus principal (Group Shared Services Latinoamérica) para los hilos de proyecto, en solo lectura y saneadas: sin permisos, hooks ni comandos propios.', author: { name: 'horus (@horus_gss_bot), Group Shared Services Latinoamérica' } }, null, 2)}\n`
  );
  writeFileSync(path.join(tmp, 'excluidas.json'), `${JSON.stringify(excluidas, null, 2)}\n`);
  writeFileSync(path.join(tmp, 'FUENTE'), `${fuente}\nArmado: ${new Date().toISOString()}\nIncluidas (${incluidas.length}): ${incluidas.map((x) => x.nombre).join(', ')}\nExcluidas (${excluidas.length}): ${excluidas.map((x) => x.nombre).join(', ')}\n`);
  log(`Total: ${incluidas.length} skills incluidas, ${excluidas.length} excluidas.`);
  if (ensayo) {
    rmSync(tmp, { recursive: true, force: true });
    log('[ensayo] no se tocó el destino.');
    return;
  }
  sellar(tmp);
  if (existsSync(destino)) {
    const bak = `${destino}.bak-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
    renameSync(destino, bak);
    log(`anterior → ${bak}`);
  }
  renameSync(tmp, destino);
  log(`listo: ${destino}`);
}

const esEntrada = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (esEntrada) {
  try {
    principal();
  } catch (e) {
    console.error(`[plugin-skills-orus] ❌ ${e.message}`);
    process.exit(1);
  }
}
