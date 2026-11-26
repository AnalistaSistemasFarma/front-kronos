/**
 * PROJECT NOTE IN THE AGENT'S OBSIDIAN VAULT (2026-11-26).
 *
 * Request from Nicolás Rivera (2026-11-26, project 39 «Feature - Proyectos Synerlink»):
 * «aplica para todos los usuarios que usen proyectos: de aquí en adelante debe crear su
 * proyecto bien ordenado en el Obsidian donde tiene su memoria o su vault».
 *
 * After every turn the bridge (not the model) keeps ONE note per SynerLink project in the
 * agent's vault folder (HILOS_VAULT_PROYECTOS_DIR, by default
 * <HILOS_CONECTORES_AGENTE_PROYECTO>/proyectos/synerlink):
 *
 *   <dir>/<project-slug>.md          one note per project, found again by `synerlink_id`
 *   <dir>/Proyectos SynerLink.md     index of every project note in the folder
 *
 * Note layout (Obsidian Flavored Markdown):
 *   - frontmatter: tags, synerlink_id, empresa, agente, actualizado, conversaciones;
 *   - «Estado» block: written by the AGENT through ./trabajo/nota-proyecto.md (full current
 *     version: objective, status, decisions, pending items, deliverables); kept as is when the
 *     turn does not bring a new one;
 *   - «Ficha» block: generated from the turn context (company, members, instructions,
 *     schedule, linked items, conversations);
 *   - «Notas propias»: never touched by the bridge (the agent's main bot or a person may write);
 *   - «Bitácora»: one short line per turn, newest first, capped.
 *
 * ENGRAM (2026-11-26, «también en engram»): after the note, the same summary (state + latest log
 * lines + where the note is) is saved in the agent's engram with a fixed topic
 * `synerlink/proyecto-<id>`, so every turn UPDATES one memory per project instead of adding new ones.
 * It uses the agent's own engram base (HILOS_VAULT_ENGRAM_* or the HILOS_CONECTORES_AGENTE_ENGRAM_*
 * values); with openclaw the data dir must be explicit (several agents share one OS user).
 *
 * Safety: text that looks like a secret is never written (memoria.mjs patterns); the bridge
 * only writes inside the configured folder, atomically, and never follows symlinks. It never
 * throws: a failure is logged and the reply is not affected.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { buscarSecreto } from './memoria.mjs';

/** File the agent writes in ./trabajo with the full current «Estado» of the project. */
export const AGENT_NOTE_FILE = 'nota-proyecto.md';
/** Copy of the current «Estado» the bridge leaves in ./contexto for the agent to update. */
export const CONTEXT_NOTE_FILE = 'nota-proyecto.md';
export const INDEX_FILE = 'Proyectos SynerLink.md';
export const MAX_AGENT_NOTE_BYTES = 24 * 1024;
export const MAX_LOG_ENTRIES = 300;
export const MAX_REQUEST_CHARS = 280;
export const MAX_REPLY_CHARS = 420;

const MARK = {
  stateStart: '<!-- synerlink:estado:inicio -->',
  stateEnd: '<!-- synerlink:estado:fin -->',
  cardStart: '<!-- synerlink:ficha:inicio -->',
  cardEnd: '<!-- synerlink:ficha:fin -->',
  ownStart: '<!-- synerlink:notas:inicio -->',
  ownEnd: '<!-- synerlink:notas:fin -->',
  log: '<!-- synerlink:bitacora -->',
};

const TASK_STATUS = { pendiente: 'Pendiente', en_curso: 'En curso', hecha: 'Hecha', bloqueada: 'Bloqueada' };
const EMPTY_STATE = '_El asistente todavía no ha escrito el estado del proyecto._';
const EMPTY_OWN = '_Espacio libre: el puente nunca modifica esta sección._';

const oneLine = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const yamlString = (v) => JSON.stringify(oneLine(v));
const BOGOTA = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
/** «AAAA-MM-DD HH:MM» in Bogotá time; the raw value when it is not a date. */
const bogotaTime = (v) => {
  const d = v instanceof Date ? v : new Date(String(v ?? ''));
  return Number.isNaN(d.getTime()) ? oneLine(v) || '—' : BOGOTA.format(d);
};

/** File-name slug for a project (Obsidian-friendly, stable, no path characters). */
export function projectSlug(name, idProject) {
  const base = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || `proyecto-${idProject}`;
}

/** Resolves the vault folder from the config; null = feature off. */
export function vaultDirFrom(cfg) {
  return cfg?.vaultProyectos?.dir ?? null;
}

/** Text without secrets: if something looks like one, the whole text is dropped. */
function safeText(text, extraSecret = null) {
  let t = String(text ?? '');
  if (extraSecret) t = t.split(extraSecret).join('[oculto]');
  return buscarSecreto(t) ? null : t;
}

/** Reads a regular file (no symlinks); null when missing or not a plain file. */
function readPlain(file, maxBytes = 2 * 1024 * 1024) {
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.size > maxBytes) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, text, { mode: 0o644 });
  renameSync(tmp, file);
}

/** Frontmatter `synerlink_id` of a note, or null. */
export function noteProjectId(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(text ?? ''));
  if (!m) return null;
  const id = /^synerlink_id:\s*(\d+)\s*$/m.exec(m[1]);
  return id ? Number(id[1]) : null;
}

function frontmatterValue(text, key) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(text ?? ''));
  if (!m) return null;
  const v = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(m[1]);
  if (!v) return null;
  const raw = v[1].trim();
  try {
    return raw.startsWith('"') ? JSON.parse(raw) : raw;
  } catch {
    return raw;
  }
}

/** Finds the note of a project in the folder (by frontmatter id); creates a new name if none. */
export function findNoteFile(dir, idProject, name) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md') || e.name === INDEX_FILE) continue;
    const text = readPlain(path.join(dir, e.name));
    if (text && noteProjectId(text) === idProject) return path.join(dir, e.name);
  }
  const slug = projectSlug(name, idProject);
  const candidate = path.join(dir, `${slug}.md`);
  return existsSync(candidate) ? path.join(dir, `${slug}-${idProject}.md`) : candidate;
}

function between(text, start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < 0 || b < a) return null;
  return text.slice(a + start.length, b).trim();
}

/** Parses the parts the bridge keeps from an existing note. */
export function parseNote(text) {
  const t = String(text ?? '');
  const logAt = t.indexOf(MARK.log);
  const logLines = logAt < 0 ? [] : t.slice(logAt + MARK.log.length).split('\n').filter((l) => l.startsWith('- '));
  let conversations = {};
  try {
    const raw = frontmatterValue(t, 'conversaciones_json');
    if (raw) conversations = JSON.parse(raw);
  } catch {
    conversations = {};
  }
  return {
    state: between(t, MARK.stateStart, MARK.stateEnd),
    own: between(t, MARK.ownStart, MARK.ownEnd),
    logLines,
    conversations: conversations && typeof conversations === 'object' ? conversations : {},
  };
}

/** Short line for the log: who asked what and what came back. */
export function logLine({ when, conversationTitle, authors, request, reply }) {
  const req = cut(oneLine(request) || '(sin texto)', MAX_REQUEST_CHARS);
  const rep = cut(
    oneLine(
      String(reply ?? '')
        .split('\n')
        .filter((l) => !/^\s*(MEDIA|PDF):/.test(l))
        .join(' ')
        .replace(/[#*_`>|]/g, '')
    ) || '(sin texto)',
    MAX_REPLY_CHARS
  );
  return `- **${when}** · «${oneLine(conversationTitle) || 'Conversación'}» · ${oneLine(authors) || 'Persona'}: ${req} → ${rep}`;
}

function cardBlock({ contexto, agent, conversations }) {
  const p = contexto.project;
  const s = p.schedule;
  const links = p.links ?? { emails: [], requests: [] };
  const l = [
    '## 📋 Ficha',
    '',
    `- **Empresa:** ${oneLine(p.company?.companyName) || '—'}`,
    `- **Perfil de conectores:** ${oneLine(p.profile?.label) || '—'}`,
    `- **Asistente:** ${oneLine(agent)}`,
    ...(p.description && safeText(p.description) ? [`- **Descripción:** ${oneLine(p.description)}`] : []),
    `- **Miembros:** ${(s?.members ?? []).map(oneLine).join(', ') || '—'}`,
    `- **Archivos del proyecto:** ${Array.isArray(p.files) ? p.files.length : 0}`,
  ];
  const instructions = p.instructions ? safeText(p.instructions) : null;
  if (instructions) {
    l.push('', '### Instrucciones del proyecto', '', ...instructions.trim().split(/\r?\n/).map((x) => `> ${x}`));
  }
  l.push('', '## 📅 Cronograma');
  if (!s) l.push('', '_No se pudo leer el cronograma en el último turno._');
  else if ((s.tasks ?? []).length === 0) l.push('', '_Sin tareas._');
  else {
    l.push('', '| Tarea | Fechas | Estado | Avance | Responsable |', '|---|---|---|---|---|');
    for (const t of s.tasks) {
      const late = (t.status === 'pendiente' || t.status === 'en_curso') && t.endDate < s.hoy ? ' ⚠️ vencida' : '';
      const title = `${t.isMilestone ? '🏁 ' : ''}${oneLine(t.title).replace(/\|/g, '/')}`;
      l.push(`| ${title} | ${t.startDate}${t.endDate !== t.startDate ? ` → ${t.endDate}` : ''} | ${TASK_STATUS[t.status] ?? oneLine(t.status)}${late} | ${t.progress ?? '—'}${t.progress !== null && t.progress !== undefined ? ' %' : ''} | ${oneLine(t.responsible).replace(/\|/g, '/') || '—'} |`);
    }
  }
  l.push('', '## 🔗 Vinculado', '');
  if (links.emails.length === 0 && links.requests.length === 0) l.push('_Nada vinculado._');
  for (const r of links.requests) l.push(`- Solicitud #${r.idRequest}: ${oneLine(r.subject)} (${oneLine(r.estado) || 'estado desconocido'})`);
  for (const e of links.emails) l.push(`- Correo: ${oneLine(e.subject) || '(sin asunto)'} — ${oneLine(e.senderName) || '—'}`);
  l.push('', '## 💬 Conversaciones', '');
  const convs = Object.entries(conversations).sort((a, b) => String(b[1]?.ultima ?? '').localeCompare(String(a[1]?.ultima ?? '')));
  if (convs.length === 0) l.push('_Sin conversaciones._');
  for (const [id, c] of convs) l.push(`- «${oneLine(c?.titulo) || 'Conversación'}» (#${id}) · última actividad ${oneLine(c?.ultima) || '—'}`);
  return l.join('\n');
}

/** Builds the whole note. Pure. */
export function buildNote({ contexto, agent, state, own, logLines, conversations, updatedAt }) {
  const p = contexto.project;
  const fm = [
    '---',
    'tags:',
    '  - proyecto',
    '  - synerlink',
    '  - estado/activo',
    `synerlink_id: ${p.idProject}`,
    `nombre: ${yamlString(p.name)}`,
    `empresa: ${yamlString(p.company?.companyName)}`,
    `agente: ${yamlString(agent)}`,
    `actualizado: ${updatedAt}`,
    `conversaciones_json: ${JSON.stringify(JSON.stringify(conversations))}`,
    '---',
  ];
  return [
    ...fm,
    '',
    `# ${oneLine(p.name)}`,
    '',
    `#proyecto #synerlink · Nota que mantiene el puente de hilos de SynerLink para ${oneLine(agent)}. Índice: [[${INDEX_FILE.replace(/\.md$/, '')}]]`,
    '',
    '## 🎯 Estado',
    '',
    MARK.stateStart,
    state?.trim() || EMPTY_STATE,
    MARK.stateEnd,
    '',
    MARK.cardStart,
    cardBlock({ contexto, agent, conversations }),
    MARK.cardEnd,
    '',
    '## 📝 Notas propias',
    '',
    MARK.ownStart,
    own?.trim() || EMPTY_OWN,
    MARK.ownEnd,
    '',
    '## 🗓️ Bitácora',
    '',
    MARK.log,
    ...logLines.slice(0, MAX_LOG_ENTRIES),
    '',
  ].join('\n');
}

/** Rebuilds the index from every project note in the folder. */
export function buildIndex(dir, agent) {
  const rows = [];
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md') || e.name === INDEX_FILE) continue;
    const text = readPlain(path.join(dir, e.name));
    const id = text ? noteProjectId(text) : null;
    if (!id) continue;
    rows.push({
      id,
      file: e.name.replace(/\.md$/, ''),
      name: frontmatterValue(text, 'nombre') ?? e.name,
      company: frontmatterValue(text, 'empresa') ?? '—',
      updated: frontmatterValue(text, 'actualizado') ?? '—',
    });
  }
  rows.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return [
    '---',
    'tags:',
    '  - indice',
    '  - synerlink',
    '---',
    '',
    '# Proyectos SynerLink',
    '',
    `Proyectos de SynerLink que atiende ${oneLine(agent)}. El puente de hilos actualiza esta lista y cada nota después de cada turno.`,
    '',
    '| Proyecto | Id | Empresa | Última actualización |',
    '|---|---|---|---|',
    ...rows.map((r) => `| [[${r.file}\\|${oneLine(r.name).replace(/\|/g, '/')}]] | ${r.id} | ${oneLine(r.company)} | ${bogotaTime(r.updated)} |`),
    '',
  ].join('\n');
}

/** Copies the current «Estado» into ./contexto so the agent can update it. Never throws. */
export function prepareVaultTurn({ dir, rutas, contexto }) {
  if (!dir) return { ok: false, file: null };
  try {
    const file = findNoteFile(dir, contexto.project.idProject, contexto.project.name);
    const prev = existsSync(file) ? parseNote(readPlain(file) ?? '') : null;
    rmSync(path.join(rutas.trabajo, AGENT_NOTE_FILE), { force: true });
    writeFileSync(path.join(rutas.contexto, CONTEXT_NOTE_FILE), `${prev?.state?.trim() || EMPTY_STATE}\n`, { mode: 0o600 });
    return { ok: true, file };
  } catch {
    return { ok: false, file: null };
  }
}

/** Header block for the model (Claude Code system text or openclaw message header). */
export function vaultHeaderText({ file, trabajo = './trabajo', contexto = './contexto' }) {
  if (!file) return '';
  return [
    '',
    '## Nota del proyecto en su vault de Obsidian (regla de Nicolás Rivera, 2026-11-26)',
    `Cada proyecto debe quedar bien ordenado en su vault. Al terminar cada turno, el puente actualiza la nota \`${file}\` (ficha, cronograma, vinculados, conversaciones y bitácora) y el índice «${INDEX_FILE}». Usted no la edita directamente.`,
    `- La sección «Estado» la escribe usted. La versión vigente está en \`${contexto}/${CONTEXT_NOTE_FILE}\`.`,
    `- Si el turno cambia algo del proyecto (avance, decisión, pendiente, entregable, PR), escriba \`${trabajo}/${AGENT_NOTE_FILE}\` con la versión COMPLETA y actualizada, en Markdown y con estos subtítulos: «### Objetivo», «### Estado actual», «### Decisiones», «### Pendientes» (con responsable) y «### Entregables». Reemplaza la anterior. Si el turno no cambia nada, no lo escriba.`,
    '- Sin secretos, contraseñas, IP ni datos personales que no hagan falta: si el texto parece tener un secreto, el puente no lo guarda.',
  ].join('\n');
}

/**
 * Updates the note and the index after a turn. Never throws.
 * @returns {{ ok: boolean, file?: string, stateUpdated?: boolean, reason?: string }}
 */
export function updateProjectNote({ dir, rutas, contexto, agent, idConversation, lote = [], reply = '', secret = null, now = new Date() }) {
  if (!dir) return { ok: false, reason: 'off' };
  try {
    if (!path.isAbsolute(dir)) return { ok: false, reason: 'the vault folder must be absolute' };
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    if (!lstatSync(dir).isDirectory()) return { ok: false, reason: 'the vault folder is not a directory' };
    const file = findNoteFile(dir, contexto.project.idProject, contexto.project.name);
    if (existsSync(file) && !lstatSync(file).isFile()) return { ok: false, reason: 'the note is not a regular file' };
    const prev = parseNote(existsSync(file) ? readPlain(file) ?? '' : '');

    // «Estado» from the agent (./trabajo/nota-proyecto.md), read and removed.
    let state = prev.state;
    let stateUpdated = false;
    let stateNote = null;
    const agentFile = rutas?.trabajo ? path.join(rutas.trabajo, AGENT_NOTE_FILE) : null;
    if (agentFile && existsSync(agentFile)) {
      const raw = readPlain(agentFile, MAX_AGENT_NOTE_BYTES);
      rmSync(agentFile, { force: true });
      const clean = raw === null ? null : safeText(raw, secret);
      if (raw === null) stateNote = 'too big or not a plain file';
      else if (clean === null) stateNote = 'looked like it had a secret';
      else if (clean.trim()) {
        state = clean.replaceAll(MARK.stateEnd, '').replaceAll(MARK.stateStart, '').trim();
        stateUpdated = true;
      }
    }

    const iso = now.toISOString();
    const when = bogotaTime(now);
    const conversations = { ...prev.conversations, [idConversation]: { titulo: oneLine(contexto.conversation?.title) || 'Conversación', ultima: when } };
    const authors = [...new Set(lote.map((m) => m?.author?.name?.trim() || m?.author?.email).filter(Boolean))].join(', ');
    const request = lote.map((m) => m?.body ?? '').join(' / ');
    const entry = logLine({ when, conversationTitle: contexto.conversation?.title, authors, request: safeText(request, secret) ?? '(omitido: parecía contener un secreto)', reply: safeText(reply, secret) ?? '(omitido: parecía contener un secreto)' });

    // A backfill (no messages and no reply) refreshes the card without a log line.
    const logLines = lote.length === 0 && !String(reply ?? '').trim() ? prev.logLines : [entry, ...prev.logLines];
    const text = buildNote({ contexto, agent, state, own: prev.own, logLines, conversations, updatedAt: iso });
    if (buscarSecreto(text)) return { ok: false, reason: 'the note looked like it had a secret; not written' };
    writeAtomic(file, text);
    writeAtomic(path.join(dir, INDEX_FILE), buildIndex(dir, agent));
    return { ok: true, file, stateUpdated, ...(stateNote ? { reason: `agent state ignored: ${stateNote}` } : {}) };
  } catch (e) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
}

/* ─────────────────────────────── Engram ─────────────────────────────── */

export const ENGRAM_TIMEOUT_MS = 20_000;
export const MAX_ENGRAM_STATE_CHARS = 6_000;
export const ENGRAM_LOG_LINES = 5;

/** Topic key of a project in engram: one memory per project, updated on every turn. */
export const engramTopic = (idProject) => `synerlink/proyecto-${idProject}`;

/** Title and content of the engram memory, from the note just written. Pure. */
export function engramMemory({ noteText, file }) {
  const id = noteProjectId(noteText);
  const name = frontmatterValue(noteText, 'nombre') ?? `Proyecto ${id}`;
  const company = frontmatterValue(noteText, 'empresa') ?? '—';
  const p = parseNote(noteText);
  const state = cut(p.state?.trim() || EMPTY_STATE, MAX_ENGRAM_STATE_CHARS);
  const content = [
    `Proyecto de SynerLink #${id} «${oneLine(name)}» (empresa ${oneLine(company)}).`,
    `Nota ordenada en el vault de Obsidian: ${file}`,
    '',
    '## Estado',
    state,
    '',
    '## Últimos turnos',
    ...(p.logLines.length ? p.logLines.slice(0, ENGRAM_LOG_LINES) : ['- (sin turnos todavía)']),
  ].join('\n');
  return { title: `Proyecto SynerLink #${id}: ${cut(oneLine(name), 80)}`, content, topic: engramTopic(id) };
}

function runFile(bin, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, opts, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve({ stdout, stderr })));
  });
}

/**
 * Saves (upserts by topic) the project memory in the agent's engram. Never throws.
 * @param {{ engram: { bin: string, project: string, dataDir?: string|null }|null, file: string, run?: Function, env?: object }} o
 */
export async function saveProjectToEngram({ engram, file, run = runFile, env = process.env }) {
  if (!engram?.bin || !engram?.project || !file) return { ok: false, reason: 'off' };
  try {
    const noteText = readPlain(file);
    if (!noteText || noteProjectId(noteText) === null) return { ok: false, reason: 'note not found' };
    const m = engramMemory({ noteText, file });
    if (buscarSecreto(`${m.title}\n${m.content}`)) return { ok: false, reason: 'looked like it had a secret; not saved' };
    const childEnv = { HOME: env.HOME, PATH: env.PATH ?? '/usr/bin:/bin', ...(engram.dataDir ? { ENGRAM_DATA_DIR: engram.dataDir } : {}) };
    await run(engram.bin, ['save', m.title, m.content, '--type', 'project', '--project', engram.project, '--topic', m.topic], { env: childEnv, timeout: ENGRAM_TIMEOUT_MS, maxBuffer: 256 * 1024 });
    return { ok: true, topic: m.topic };
  } catch (e) {
    return { ok: false, reason: oneLine(e?.stderr || e?.message || e).slice(0, 300) };
  }
}
