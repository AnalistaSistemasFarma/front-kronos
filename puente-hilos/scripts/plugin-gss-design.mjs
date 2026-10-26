#!/usr/bin/env node
/**
 * Arma el plugin LOCAL de solo lectura `gss-design` para el puente de hilos.
 *
 *   node scripts/plugin-gss-design.mjs [--fuente ~/brain/gss-design] [--destino ~/.puente-hilos/plugins/gss-design]
 *                                      [--fuentes-dir <carpeta con fuentes.css y *.woff2 ya descargados>] [--ensayo]
 *
 * Resultado:
 *   <destino>/.claude-plugin/plugin.json
 *   <destino>/skills/gss-design/SKILL.md      (plantilla plugins/gss-design/SKILL.md con las rutas absolutas)
 *   <destino>/recursos/                        README.md, colors_and_type.css (fuentes LOCALES), fuentes/,
 *                                              assets/, slides/, preview/  — todo de solo lectura (0444/0555)
 *   <destino>/FUENTE                           ruta y commit de la fuente
 *
 * El puente monta <destino>/recursos con --add-dir (solo lectura: Edit/Write siguen en ./trabajo) y deja
 * que Chrome lo lea al convertir a PDF (pdf.mjs). Sin internet al convertir: por eso las fuentes van
 * locales (DM Sans, Source Sans 3 y Oi, licencia OFL, subconjuntos latin y latin-ext de Google Fonts).
 * Se construye en una carpeta temporal y se cambia de un golpe; la anterior queda como <destino>.bak-<fecha>.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PLANTILLA = path.join(AQUI, '..', 'plugins', 'gss-design');
const GOOGLE = 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Source+Sans+3:wght@400;500;600;700&family=Oi&display=swap';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0 Safari/537.36';
const COPIAR = ['README.md', 'assets', 'slides', 'preview'];

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : porDefecto;
}
const fuente = path.resolve(arg('--fuente', path.join(homedir(), 'brain', 'gss-design')));
const destino = path.resolve(arg('--destino', path.join(homedir(), '.puente-hilos', 'plugins', 'gss-design')));
const fuentesDir = arg('--fuentes-dir', null);
const ensayo = process.argv.includes('--ensayo');
const log = (m) => console.log(`[plugin-gss-design] ${m}`);

if (!existsSync(path.join(fuente, 'SKILL.md')) || !existsSync(path.join(fuente, 'colors_and_type.css'))) {
  console.error(`No encuentro la skill gss-design en ${fuente}.`);
  process.exit(1);
}
if (destino.split(path.sep).includes('claude-config')) {
  console.error('El destino no puede estar dentro del config de un bot.');
  process.exit(1);
}
let commit = 'sin-git';
try {
  commit = execFileSync('git', ['-C', fuente, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {}

/** Bloques @font-face latin y latin-ext del CSS de Google, con sus URL. */
function bloquesFuentes(css) {
  const out = [];
  const re = /\/\*\s*(latin(?:-ext)?)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g;
  let m;
  while ((m = re.exec(css))) {
    const url = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/.exec(m[2])?.[1];
    if (url) out.push({ subconjunto: m[1], bloque: m[2], url });
  }
  return out;
}

async function prepararFuentes(dir) {
  mkdirSync(dir, { recursive: true });
  if (fuentesDir) {
    cpSync(path.resolve(fuentesDir), dir, { recursive: true });
    if (!existsSync(path.join(dir, 'fuentes.css'))) throw new Error('--fuentes-dir no trae fuentes.css');
    return;
  }
  const css = await (await fetch(GOOGLE, { headers: { 'user-agent': UA } })).text();
  const bloques = bloquesFuentes(css);
  if (bloques.length < 6) throw new Error(`Google Fonts devolvió ${bloques.length} bloques latin; esperaba al menos 6.`);
  const nombres = new Map();
  let salida = '/* Fuentes de marca GSS LOCALES (licencia SIL OFL 1.1), subconjuntos latin y latin-ext de Google Fonts.\n   Generado por puente-hilos/scripts/plugin-gss-design.mjs: no editar a mano. */\n';
  for (const b of bloques) {
    if (!nombres.has(b.url)) {
      const familia = /font-family:\s*'([^']+)'/.exec(b.bloque)?.[1] ?? 'fuente';
      const n = `${familia.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${b.subconjunto}-${nombres.size + 1}.woff2`;
      const r = await fetch(b.url, { headers: { 'user-agent': UA } });
      if (!r.ok) throw new Error(`No se pudo bajar ${b.url}: HTTP ${r.status}`);
      const datos = Buffer.from(await r.arrayBuffer());
      if (datos.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error(`${b.url} no es woff2`);
      writeFileSync(path.join(dir, n), datos);
      nombres.set(b.url, n);
    }
    salida += `/* ${b.subconjunto} */\n${b.bloque.replace(b.url, nombres.get(b.url)).replace('font-display: swap', 'font-display: block')}\n`;
  }
  writeFileSync(path.join(dir, 'fuentes.css'), salida);
  log(`fuentes: ${nombres.size} woff2, ${bloques.length} bloques @font-face.`);
}

function soloLectura(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) soloLectura(p);
    else chmodSync(p, 0o444);
  }
  chmodSync(dir, 0o555);
}

function hacerEscribible(dir) {
  if (!existsSync(dir)) return;
  chmodSync(dir, 0o755);
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) hacerEscribible(p);
    else if (!e.isSymbolicLink()) chmodSync(p, 0o644);
  }
}

const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
const tmp = `${destino}.nuevo-${ts}`;
const recursos = path.join(destino, 'recursos');
log(`fuente ${fuente} (commit ${commit}) → ${destino}${ensayo ? ' (ENSAYO: se arma en una carpeta temporal y se borra)' : ''}`);

mkdirSync(path.dirname(destino), { recursive: true, mode: 0o700 });
rmSync(tmp, { recursive: true, force: true });
const rTmp = path.join(tmp, 'recursos');
mkdirSync(rTmp, { recursive: true });
for (const n of COPIAR) cpSync(path.join(fuente, n), path.join(rTmp, n), { recursive: true, dereference: true, filter: (s) => !path.basename(s).startsWith('.') });
await prepararFuentes(path.join(rTmp, 'fuentes'));
const css = readFileSync(path.join(fuente, 'colors_and_type.css'), 'utf8');
const conLocal = css.replace(/@import\s+url\(['"]?https:\/\/fonts\.googleapis\.com[^)]*\);?/, "@import url('fuentes/fuentes.css'); /* fuentes locales: sin internet al convertir a PDF */");
if (conLocal === css) throw new Error('No encontré el @import de Google Fonts en colors_and_type.css');
if (/https?:\/\//.test(conLocal.replace(/\/\*[\s\S]*?\*\//g, ''))) throw new Error('colors_and_type.css todavía tiene recursos externos');
writeFileSync(path.join(rTmp, 'colors_and_type.css'), conLocal);

const sustituir = (t) => t.replaceAll('{{RECURSOS}}', recursos).replaceAll('{{FUENTE}}', fuente).replaceAll('{{COMMIT}}', commit).replaceAll('{{VERSION}}', `1.0.0-gss.${commit}`);
mkdirSync(path.join(tmp, '.claude-plugin'), { recursive: true });
writeFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), sustituir(readFileSync(path.join(PLANTILLA, 'plugin.json'), 'utf8')));
mkdirSync(path.join(tmp, 'skills', 'gss-design'), { recursive: true });
writeFileSync(path.join(tmp, 'skills', 'gss-design', 'SKILL.md'), sustituir(readFileSync(path.join(PLANTILLA, 'SKILL.md'), 'utf8')));
writeFileSync(path.join(tmp, 'FUENTE'), `${fuente}\n${commit}\n${ts}\n`);
JSON.parse(readFileSync(path.join(tmp, '.claude-plugin', 'plugin.json'), 'utf8'));
soloLectura(tmp);
const tam = execFileSync('du', ['-sh', tmp], { encoding: 'utf8' }).split('\t')[0];
log(`armado en ${tmp} (${tam}).`);

if (ensayo) {
  hacerEscribible(tmp);
  rmSync(tmp, { recursive: true, force: true });
  log('ENSAYO: nada cambió.');
} else {
  if (existsSync(destino)) {
    const bak = `${destino}.bak-${ts}`;
    // El respaldo queda fuera de HILOS_PLUGIN_DIRS (otro nombre de carpeta), así no se carga.
    renameSync(destino, bak);
    log(`anterior → ${bak}`);
  }
  renameSync(tmp, destino);
  log(`listo: ${destino} (${statSync(destino).isDirectory() ? 'ok' : '??'}).`);
}
