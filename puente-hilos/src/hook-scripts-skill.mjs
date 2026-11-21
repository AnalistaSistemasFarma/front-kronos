#!/usr/bin/env node
/**
 * PreToolUse hook for skill scripts in project threads (chat-parity.mjs).
 *
 *   node hook-scripts-skill.mjs <config.json>   (config: { interpreters: [...], roots: [...] })
 *
 * Only judges Bash calls that start with one of the allowed interpreters: those must be exactly
 * «<interpreter> <script under a root> [plain args]» (checkScriptCommand) or they are denied.
 * Any other Bash call gets no opinion here: in a turn without code access it is denied anyway by
 * `dontAsk` (it matches no allow rule); in a turn with code access it follows the code rules.
 * Unreadable input or config: deny (fail closed).
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkScriptCommand } from './chat-parity.mjs';

const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Scripts de skills: ${reason}.` } });

/** Decision for one hook input. null = no opinion. */
export function decide(input, config, realpath = realpathSync) {
  if (input?.tool_name !== 'Bash') return null;
  const command = String(input.tool_input?.command ?? '').trim();
  const interpreters = Array.isArray(config?.interpreters) ? config.interpreters : [];
  const first = command.split(/\s+/)[0] ?? '';
  const base = first.split('/').pop();
  // Interpreter-like commands (allowed paths or any python/node name) must pass the strict check.
  const looksLikeInterpreter = interpreters.includes(first) || /^(python[0-9.]*|node|nodejs)$/.test(base);
  if (!looksLikeInterpreter) return null;
  const r = checkScriptCommand(command, { interpreters, roots: config?.roots ?? [], realpath });
  return r.ok ? null : deny(r.reason);
}

function main() {
  let input;
  let config;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
    config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  } catch {
    process.stdout.write(JSON.stringify(deny('entrada o configuración ilegible')));
    return;
  }
  const d = decide(input, config);
  if (d) process.stdout.write(JSON.stringify(d));
}

let isEntry = false;
try {
  isEntry = Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
} catch {}
if (isEntry) main();
