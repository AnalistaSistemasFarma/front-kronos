#!/usr/bin/env node
/**
 * Hook PreToolUse de los turnos con código (lo instala codigo.mjs → settingsHookCodigo).
 *
 * Los SUBAGENTES del equipo pueden usar Bash SOLO para git de lectura. Claude
 * Code no permite reglas por subagente: un `disallowedTools` con patrón en la
 * definición del subagente le quita la herramienta entera (verificado en
 * 2.1.299: `Bash(git * push *)` dejó al subagente sin Bash y `Read(**\/.env)`
 * sin Read). Por eso el control va aquí: el hook recibe `agent_id`/`agent_type`
 * cuando quien llama es un subagente y niega todo lo que no sea git de lectura.
 * El agente principal (sin `agent_id`) sigue con sus reglas normales.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const GIT_LECTURA_SUB = ['status', 'log', 'show', 'diff', 'ls-files', 'ls-tree', 'grep', 'blame', 'shortlog', 'describe', 'rev-parse', 'merge-base', 'cat-file', 'branch', 'rev-list'];
const FILTROS = ['head', 'tail', 'wc', 'grep', 'sort', 'uniq', 'cut'];

/** ¿El comando es git de SOLO lectura (con filtros por tubería)? */
export function esGitLectura(comando) {
  const c = String(comando ?? '').trim();
  if (!c || /[;&`<>\n]|\$\(|\|\|/.test(c)) return false;
  const partes = c.split('|').map((p) => p.trim());
  const m = /^git\s+-C\s+(\S+)\s+([a-z-]+)(\s|$)/.exec(partes[0]);
  if (!m || !GIT_LECTURA_SUB.includes(m[2])) return false;
  if (/\s--(output|exec|ext-diff|textconv)\b|\s-o\s/.test(partes[0])) return false;
  // `git branch` solo para listar.
  const resto = partes[0].slice(m[0].length - (m[3] ? m[3].length : 0));
  if (m[2] === 'branch' && /(^|\s)-(d|D|m|M|c|C|f)\b|--(delete|move|copy|force|set-upstream)/.test(resto)) return false;
  return partes.slice(1).every((p) => FILTROS.includes(p.split(/\s+/)[0]));
}

/** Decisión del hook para una entrada. null = no opina (sigue el flujo normal). */
export function decidir(entrada) {
  if (!entrada?.agent_id) return null; // agente principal
  if (entrada.tool_name !== 'Bash') return null;
  if (esGitLectura(entrada.tool_input?.command)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Subagente ${entrada.agent_type ?? ''}: solo git de lectura con «git -C codigo/<repo> log|show|diff|ls-files|ls-tree|grep|blame|status…». Lo demás lo hace el asistente principal.`,
    },
  };
}

function principal() {
  let entrada = null;
  try {
    entrada = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    // Entrada ilegible: falla cerrado para subagentes no se puede saber; se niega.
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Hook: entrada ilegible.' } }));
    return;
  }
  const d = decidir(entrada);
  if (d) process.stdout.write(JSON.stringify(d));
}

let esEntrada = false;
try {
  esEntrada = Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
} catch {}
if (esEntrada) principal();
