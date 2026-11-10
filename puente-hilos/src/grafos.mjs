/**
 * GRAPHIFY en los hilos de proyecto (pedido de Nicolás Rivera, 2026-10-21).
 *
 * Claude Code en `--restricted` NO carga las skills del config dir ni de la
 * carpeta del proyecto (verificado en 2.1.299): la única vía explícita es
 * `--plugin-dir`. Por eso:
 *
 *   - HILOS_PLUGIN_DIRS: plugins locales (carpetas con .claude-plugin/plugin.json)
 *     que se cargan en CADA turno con `--plugin-dir`, y la herramienta Skill.
 *   - HILOS_GRAFOS_DIR: carpeta con los grafos ya construidos por repo
 *     (<dir>/<repo>/graphify-out, GRAPHIFY_BACKEND=none). En un turno con código
 *     se monta en solo lectura (--add-dir; Edit/Write siguen solo en ./trabajo y
 *     ./codigo) el grafo de cada repo MONTADO, y se dice en el encabezado.
 *
 * Graphify va SIEMPRE local: el entorno del hijo lleva GRAPHIFY_BACKEND=none
 * (claude.mjs) y, además, la instalación tiene una guardia propia.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Comandos de Graphify de SOLO LECTURA sobre un graph.json (no escriben nada). */
export const GRAPHIFY_LECTURA = ['graphify query', 'graphify path', 'graphify explain', 'graphify god-nodes', 'graphify affected'];

/** Reglas Bash para un turno con código (sandbox): solo consultas, nunca update/label/install. */
export function permisosGrafos() {
  const permitidas = [];
  for (const c of GRAPHIFY_LECTURA) permitidas.push(`Bash(${c} *)`);
  const prohibidas = ['install', 'uninstall', 'label', 'cluster-only', 'extract', 'add', 'clone', 'hook', 'watch', 'serve'].flatMap((c) => [`Bash(graphify ${c} *)`, `Bash(graphify ${c})`]);
  return { permitidas, prohibidas };
}

/** Grafos de los repos montados en el turno: [{ nombre, dir, commit }], solo los que existen. */
export function grafosDelTurno(grafosDir, worktrees = [], existe = existsSync, leer = (r) => readFileSync(r, 'utf8')) {
  if (!grafosDir) return [];
  const out = [];
  for (const w of worktrees) {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(w?.nombre ?? '')) continue;
    const dir = path.join(grafosDir, w.nombre, 'graphify-out');
    if (!existe(path.join(dir, 'graph.json'))) continue;
    let commit = null;
    try {
      commit = leer(path.join(grafosDir, w.nombre, 'COMMIT')).trim().slice(0, 40) || null;
    } catch {}
    out.push({ nombre: w.nombre, dir, commit });
  }
  return out;
}

/** Bloque del encabezado con los grafos montados. */
export function textoGrafos(grafos, { conBash = false } = {}) {
  if (!grafos.length) return '';
  const l = ['', '## Grafos de Graphify (código ya analizado, modo local)', '', 'Antes de recorrer el código a mano para preguntas de arquitectura o dependencias, use el grafo del repo (skill `graphify:grafos-proyectos`). Empiece por `GRAPH_REPORT.md`. Es de la rama de pruebas: no incluye sus cambios sin subir; confirme siempre en `./codigo/<repo>` antes de afirmar o editar.', ''];
  for (const g of grafos) l.push(`- **${g.nombre}**: \`${g.dir}/GRAPH_REPORT.md\` y \`${g.dir}/graph.json\`${g.commit ? ` (commit \`${g.commit}\`)` : ''}. Solo lectura.`);
  if (conBash) l.push('', 'Con Bash: `graphify query "<pregunta>" --graph <ruta>/graph.json --budget 1500`, `graphify explain "<símbolo>" --graph …`, `graphify path "A" "B" --graph …`, `graphify affected "<archivo>" --graph …`. NO use `graphify update/label/install` ni `--backend`, y nunca genere `graphify-out/` dentro de `./codigo`.');
  return l.join('\n');
}
