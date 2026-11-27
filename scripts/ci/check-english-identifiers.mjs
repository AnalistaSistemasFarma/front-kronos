#!/usr/bin/env node
/**
 * English-only code guard (rule from Nicolás Rivera, 2026-11-27).
 *
 * Code, comments, file names and database objects must be in English. Only
 * user-facing UI strings stay in Spanish. This script blocks NEW Spanish names:
 *
 *   - identifiers in .ts/.tsx/.js/.jsx/.mjs/.cjs/.sql/.prisma files
 *     (string literals and JSX text are ignored: they are UI copy);
 *   - database object names: Prisma models/fields and @map/@@map/map: names,
 *     and identifiers in prisma/manual/*.sql and other .sql files;
 *   - new path segments (folders and file names);
 *   - Spanish comments on added lines.
 *
 * Legacy names that already exist in the repository are listed in
 * scripts/ci/english-identifiers-baseline.txt and do not fail the check, so
 * only names added after the rule fail. Do not add new names to the baseline by
 * hand: rename them to English instead.
 *
 * Usage:
 *   node scripts/ci/check-english-identifiers.mjs                 # diff vs origin/testing
 *   node scripts/ci/check-english-identifiers.mjs --base <ref>    # diff vs <ref> (merge-base)
 *   node scripts/ci/check-english-identifiers.mjs --write-baseline
 *   node scripts/ci/check-english-identifiers.mjs --inventory [--json <file>]
 *   node scripts/ci/check-english-identifiers.mjs --text "<PR title or commit subject>"
 *
 * Exit code 1 when a violation is found (check mode / --text mode).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORDS_FILE = path.join(HERE, 'spanish-words.txt');
const BASELINE_FILE = path.join(HERE, 'english-identifiers-baseline.txt');

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const CHECKED_EXT = new Set([...CODE_EXT, '.sql', '.prisma']);
// Generated or vendored content: never checked.
const IGNORED_PATHS = [/^node_modules\//, /(^|\/)node_modules\//, /^app\/generated\//, /^\.next\//, /^public\//, /\.min\.js$/, /^prisma\/migrations\//, /^scripts\/ci\/spanish-words\.txt$/];

// ---------------------------------------------------------------------------
// Spanish detection
// ---------------------------------------------------------------------------
let cachedWords = null;
function defaultWords() {
  return (cachedWords ??= loadWords());
}

/** Word list. Lines starting with `!` are English exceptions (for example `!paras`). */
export function loadWords(file = WORDS_FILE) {
  const words = new Set();
  const exceptions = new Set();
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    if (l.startsWith('!')) exceptions.add(l.slice(1));
    else words.add(l);
  }
  words.exceptions = exceptions;
  return words;
}

const ACCENTED = /[áéíóúñüÁÉÍÓÚÑÜ]/;

export function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Split an identifier into lowercase words: camelCase, PascalCase, snake_case, kebab-case, digits. */
export function splitWords(id) {
  return id
    .replace(/([a-záéíóúñü])([A-ZÁÉÍÓÚÑÜ])/g, '$1 $2')
    .replace(/([A-ZÁÉÍÓÚÑÜ]+)([A-ZÁÉÍÓÚÑÜ][a-záéíóúñü])/g, '$1 $2')
    .split(/[^A-Za-z0-9áéíóúñüÁÉÍÓÚÑÜ]+|(?<=\D)(?=\d)|(?<=\d)(?=\D)/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

function isSpanishWord(word, words) {
  const w = stripAccents(word);
  if (w.length < 3 || words.exceptions?.has(w)) return false;
  if (words.has(w)) return true;
  if (w.endsWith('es') && words.has(w.slice(0, -2))) return true;
  if (w.endsWith('s') && words.has(w.slice(0, -1))) return true;
  return false;
}

/** Returns the Spanish word that makes the identifier Spanish, or null. */
export function spanishReason(id, words) {
  if (ACCENTED.test(id)) return 'accent';
  for (const w of splitWords(id)) if (isSpanishWord(w, words)) return w;
  return null;
}

// Function words that only appear in Spanish prose (used for comments and PR texts).
const SPANISH_PROSE = new Set(
  'el la de en y al se un que los las del para por una con como cuando pero esto este esta estos estas también tambien porque según segun hay sólo desde sin sobre entre cada donde aquí aqui ahora antes después despues mismo todos todas nunca siempre puede debe hace hacer cuál cual qué cómo usuario solicitud empresa'.split(' ')
);

/** True when a piece of prose (comment, PR title, commit subject) reads as Spanish. */
export function isSpanishProse(text, words = defaultWords()) {
  // Quoted examples of Spanish user input or UI copy are allowed: «…», "…", '…', `…`.
  text = text.replace(/«[^»]*»?|"[^"]*"|'[^']*'|`[^`]*`/g, ' ');
  const tokens = stripAccents(text.toLowerCase()).match(/[a-zñ]+/g) ?? [];
  if (tokens.length < 3) return false;
  let hits = 0;
  let vocabulary = 0;
  for (const t of tokens) {
    if (SPANISH_PROSE.has(t)) hits++;
    else if (t.length >= 4 && isSpanishWord(t, words)) vocabulary++;
  }
  if (/[áéíóúñ¿¡]/i.test(text) && hits >= 1) return true;
  if (hits >= 2 && hits / tokens.length >= 0.08) return true;
  // Mostly Spanish vocabulary ("cronograma de mantenimiento y repuestos"); an English sentence
  // that names one or two legacy Spanish tables stays below the ratio.
  return vocabulary >= 2 && (vocabulary + hits) / tokens.length >= 0.4;
}

// ---------------------------------------------------------------------------
// Lexers: return per-line lists of identifiers and comments
// ---------------------------------------------------------------------------
const IDENT_RE = /[A-Za-z_$áéíóúñüÁÉÍÓÚÑÜ][A-Za-z0-9_$áéíóúñüÁÉÍÓÚÑÜ]*/g;

function pushIdents(out, line, text) {
  for (const m of text.matchAll(IDENT_RE)) (out.idents[line] ??= []).push(m[0]);
}

/**
 * JS/TS lexer. Strings, template text and regex literals are dropped; code
 * goes to identifiers; comments go to comments. JSX text in .tsx/.jsx is
 * dropped with a line heuristic.
 */
export function lexJs(src, { jsx = false } = {}) {
  /** @type {{ idents: Record<number, string[]>, comments: Record<number, string> }} */
  const out = { idents: {}, comments: {} };
  const lines = src.split('\n');
  let state = 'code'; // code | block | template
  const stack = []; // template nesting: brace depth for ${ }
  let braceDepth = 0;
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    let code = '';
    let comment = '';
    let i = 0;
    let lastSig = '';
    while (i < line.length) {
      const c = line[i];
      const n = line[i + 1];
      if (state === 'block') {
        const end = line.indexOf('*/', i);
        if (end === -1) { comment += line.slice(i); i = line.length; } else { comment += line.slice(i, end); i = end + 2; state = 'code'; }
        continue;
      }
      if (state === 'template') {
        if (c === '\\') { i += 2; continue; }
        if (c === '`') { state = stack.length && stack[stack.length - 1].inTemplateOf ? 'code' : 'code'; i++; code += ' '; continue; }
        if (c === '$' && n === '{') { stack.push({ depth: braceDepth }); braceDepth++; state = 'code'; i += 2; code += ' '; continue; }
        i++;
        continue;
      }
      // code
      if (c === '/' && n === '/') { comment += line.slice(i + 2); break; }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < line.length && line[j] !== c) j += line[j] === '\\' ? 2 : 1;
        i = j + 1; code += ' ""'; lastSig = '"';
        continue;
      }
      if (c === '`') { state = 'template'; i++; continue; }
      if (c === '/' && (lastSig === '' || '(,=:[!&|?{};+-*%<>~^'.includes(lastSig) || /\b(return|typeof|case|in|of)\s*$/.test(code))) {
        // regex literal
        let j = i + 1;
        let cls = false;
        while (j < line.length) {
          if (line[j] === '\\') { j += 2; continue; }
          if (line[j] === '[') cls = true; else if (line[j] === ']') cls = false; else if (line[j] === '/' && !cls) break;
          j++;
        }
        if (j < line.length) { i = j + 1; while (/[a-z]/.test(line[i] ?? '')) i++; code += ' /r/ '; lastSig = ')'; continue; }
      }
      if (c === '{') braceDepth++;
      if (c === '}') {
        braceDepth--;
        if (stack.length && stack[stack.length - 1].depth === braceDepth) { stack.pop(); state = 'template'; i++; code += ' '; continue; }
      }
      code += c;
      if (!/\s/.test(c)) lastSig = c;
      i++;
    }
    if (state === 'template') code += ' ';
    if (jsx) code = stripJsxText(code);
    pushIdents(out, ln + 1, code);
    const cm = comment.replace(/^[\s*]+/, '').trim();
    if (cm) out.comments[ln + 1] = cm;
  }
  return out;
}

const CODE_START = /^(import|export|return|const|let|var|type|interface|function|async|await|case|default|if|else|from|extends|implements|class|enum|declare|throw|new|yield|for|while|switch|try|catch|finally)\b/;

/**
 * Drops JSX text. Brace expressions `{...}` are kept as code; the text around
 * them is dropped when it is inside `>…<` or when the line reads as prose.
 */
export function stripJsxText(code) {
  const kept = [];
  let skel = code;
  for (let k = 0; k < 4; k++) {
    const next = skel.replace(/\{([^{}]*)\}/g, (_, inner) => { kept.push(stripTagText(inner)); return ' {} '; });
    if (next === skel) break;
    skel = next;
  }
  skel = stripTagText(skel);
  // Text after a tag end at the end of the line: `<p ...>Texto {x}`.
  skel = skel.replace(/(?<![=-])>([^<>]*)$/, (m, rest) => (/[=;]|=>|&&|\|\|/.test(rest) ? m : '>'));
  // Text before a closing tag at the start of the line: `texto</p>`.
  skel = skel.replace(/^([^<>=;]*)(?=<\/)/, '');
  // Prose before an opening tag at the start of the line: `Texto del lote {} <Badge>`.
  skel = skel.replace(/^\s*([A-ZÁÉÍÓÚÑa-záéíóúñ][^<>=;(]*?\s)(?=<[A-Za-z])/, (m, txt) => (CODE_START.test(txt.trim()) || /^[a-z_$][\w$]*$/.test(txt.trim()) ? m : ''));
  const t = skel.replace(/\{\}/g, ' ').trim();
  const isProse =
    t &&
    !/=|&&|\|\||\?\.|\?\?|;\s*$/.test(t) &&
    !CODE_START.test(t) &&
    !/^[}\]](?!\s*$)/.test(t) &&
    !/^\)\s*(?![.,;:]?\s+[A-Za-zÁÉÍÓÚÑáéíóúñ])/.test(t) &&
    !/^[a-z_$][\w$]*\??:/.test(t.replace(/^readonly\s+/, '')) &&
    (/[áéíóúñ¿¡]/i.test(t) || /[A-Za-z]+ [A-Za-z]+/.test(t) || /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/.test(t.replace(/\{\}|\(\s*\)/g, '').trim()));
  const base = isProse ? '' : skel;
  return [base, ...kept].join(' ');
}

/** Drops text between a tag end and the next tag: `<p ...>Texto {}</p>`. */
function stripTagText(s) {
  return s.replace(/(?<![=-])>((?:[^<>{}]|\{\})*)(?=<\/?[A-Za-z>])/g, '>');
}

/** T-SQL lexer: '--' and block comments, 'strings' (dropped), [names] and "names" (kept). */
export function lexSql(src) {
  /** @type {{ idents: Record<number, string[]>, comments: Record<number, string> }} */
  const out = { idents: {}, comments: {} };
  const lines = src.split('\n');
  let state = 'code';
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    let code = '';
    let comment = '';
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      const n = line[i + 1];
      if (state === 'block') {
        const end = line.indexOf('*/', i);
        if (end === -1) { comment += line.slice(i); i = line.length; } else { comment += line.slice(i, end); i = end + 2; state = 'code'; }
        continue;
      }
      if (state === 'string') {
        if (c === "'" && n === "'") { i += 2; continue; }
        if (c === "'") { state = 'code'; }
        i++;
        continue;
      }
      if (c === '-' && n === '-') { comment += line.slice(i + 2); break; }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
      if (c === "'") { state = 'string'; i++; code += ' '; continue; }
      if (c === '[' || c === '"') { code += ' '; i++; continue; }
      if (c === ']') { code += ' '; i++; continue; }
      code += c;
      i++;
    }
    pushIdents(out, ln + 1, code);
    const cm = comment.trim();
    if (cm) out.comments[ln + 1] = cm;
  }
  return out;
}

/** Prisma schema: identifiers outside strings + DB names in @map/@@map/map:/name:. */
export function lexPrisma(src) {
  /** @type {{ idents: Record<number, string[]>, comments: Record<number, string> }} */
  const out = { idents: {}, comments: {} };
  const lines = src.split('\n');
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    const ci = line.indexOf('//');
    const codePart = ci === -1 ? line : line.slice(0, ci);
    if (ci !== -1) {
      const cm = line.slice(ci).replace(/^\/+/, '').trim();
      if (cm) out.comments[ln + 1] = cm;
    }
    for (const m of codePart.matchAll(/(?:@@?map\(|\bmap:|\bname:)\s*(?:name:)?\s*"([^"]+)"/g)) {
      (out.idents[ln + 1] ??= []).push(m[1]);
    }
    pushIdents(out, ln + 1, codePart.replace(/"([^"\\]|\\.)*"/g, ' '));
  }
  return out;
}

export function lexFile(file, src) {
  const ext = path.extname(file);
  if (ext === '.sql') return lexSql(src);
  if (ext === '.prisma') return lexPrisma(src);
  return lexJs(src, { jsx: ext === '.tsx' || ext === '.jsx' });
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------
function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 512, ...opts });
}

function isChecked(file) {
  return CHECKED_EXT.has(path.extname(file)) && !IGNORED_PATHS.some((re) => re.test(file));
}

function isIgnored(file) {
  return IGNORED_PATHS.some((re) => re.test(file));
}

/** Path segments (folders and base names without extension) that read as Spanish. */
function spanishSegments(file, words) {
  const res = [];
  for (const raw of file.split('/')) {
    const seg = raw.replace(/\.[^.]+$/, '').replace(/\.(test|spec|d)$/, '');
    const clean = seg.replace(/^[([]+|[)\]]+$/g, '').replace(/^\.\.\./, '');
    if (!clean) continue;
    const why = spanishReason(clean, words);
    if (why) res.push({ segment: clean, why });
  }
  return res;
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------
const DB_EXT = new Set(['.sql', '.prisma']);

function collectAll(words) {
  const files = git(['ls-files']).split('\n').filter(Boolean);
  const idents = new Map(); // id -> { count, files:Set, why, db }
  const segments = new Map();
  for (const file of files) {
    if (isIgnored(file)) continue;
    for (const s of spanishSegments(file, words)) {
      const e = segments.get(s.segment) ?? { count: 0, files: new Set(), why: s.why };
      e.count++;
      e.files.add(file);
      segments.set(s.segment, e);
    }
    if (!isChecked(file) || !existsSync(file)) continue;
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    const lx = lexFile(file, src);
    const isDb = DB_EXT.has(path.extname(file));
    for (const ids of Object.values(lx.idents)) {
      for (const id of ids) {
        const why = spanishReason(id, words);
        if (!why) continue;
        const e = idents.get(id) ?? { count: 0, files: new Set(), why, db: false };
        e.count++;
        e.files.add(file);
        if (isDb) e.db = true;
        idents.set(id, e);
      }
    }
  }
  return { idents, segments };
}

function loadBaseline() {
  const code = new Set();
  const db = new Set();
  const paths = new Set();
  if (!existsSync(BASELINE_FILE)) return { code, db, paths };
  for (const raw of readFileSync(BASELINE_FILE, 'utf8').split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    if (l.startsWith('path:')) paths.add(l.slice(5));
    else if (l.startsWith('db:')) { db.add(l.slice(3)); code.add(l.slice(3)); }
    else code.add(l);
  }
  return { code, db, paths };
}

function writeBaseline(words) {
  const { idents, segments } = collectAll(words);
  const header = [
    '# Legacy Spanish names that existed before the English-only rule (2026-11-27).',
    '# Generated by: node scripts/ci/check-english-identifiers.mjs --write-baseline',
    '# db:<name>   = database name (Prisma schema or SQL). New code may use it (until it is migrated).',
    '# <name>      = legacy code name. New code may use it, but may not declare it again.',
    '# path:<name> = legacy file or folder name.',
    '# Do NOT add new names here: rename them to English. Remove names when they are migrated.',
  ];
  const all = [
    ...[...idents.entries()].map(([id, e]) => (e.db ? `db:${id}` : id)),
    ...[...segments.keys()].map((s) => `path:${s}`),
  ].sort();
  writeFileSync(BASELINE_FILE, [...header, ...all].join('\n') + '\n');
  console.log(`Baseline written: ${idents.size} identifiers (${[...idents.values()].filter((e) => e.db).length} database names), ${segments.size} path segments -> ${path.relative(process.cwd(), BASELINE_FILE)}`);
}

function inventory(words, jsonFile) {
  const { idents, segments } = collectAll(words);
  const byArea = {};
  const area = (f) => {
    const p = f.split('/');
    if (p[0] === 'app' && p[1] === 'api') return `app/api/${p[2] ?? ''}`;
    if (p[0] === 'app') return `app/${p[1] ?? ''}`;
    return p.length > 2 ? `${p[0]}/${p[1]}` : p[0];
  };
  for (const [id, e] of idents) {
    for (const f of e.files) {
      const a = area(f);
      (byArea[a] ??= new Set()).add(id);
    }
  }
  const summary = Object.entries(byArea).map(([a, s]) => [a, s.size]).sort((x, y) => y[1] - x[1]);
  const result = {
    distinctIdentifiers: idents.size,
    occurrences: [...idents.values()].reduce((n, e) => n + e.count, 0),
    distinctPathSegments: segments.size,
    filesWithSpanishPath: new Set([...segments.values()].flatMap((e) => [...e.files])).size,
    byArea: Object.fromEntries(summary),
    topIdentifiers: [...idents.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 200).map(([id, e]) => ({ id, count: e.count, files: e.files.size })),
    pathSegments: [...segments.entries()].sort((a, b) => b[1].count - a[1].count).map(([s, e]) => ({ segment: s, files: e.count })),
  };
  if (jsonFile) writeFileSync(jsonFile, JSON.stringify(result, null, 1));
  console.log(`Distinct Spanish identifiers: ${result.distinctIdentifiers} (${result.occurrences} occurrences)`);
  console.log(`Spanish path segments: ${result.distinctPathSegments} (in ${result.filesWithSpanishPath} files)`);
  for (const [a, n] of summary.slice(0, 40)) console.log(`  ${String(n).padStart(6)}  ${a}`);
}

/** Added line numbers per file in base...HEAD (or vs the working tree with --worktree). */
function addedLines(base) {
  const diff = git(['diff', '--unified=0', '--no-color', '--no-ext-diff', '--diff-filter=AMR', `${base}...HEAD`]);
  const map = new Map();
  let file = null;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) { file = l.startsWith('+++ b/') ? l.slice(6) : null; if (file) map.set(file, new Set()); continue; }
    const h = /^@@ -[\d,]+ \+(\d+),?(\d*) @@/.exec(l);
    if (h && file) {
      const start = Number(h[1]);
      const count = h[2] === '' ? 1 : Number(h[2]);
      for (let k = 0; k < count; k++) map.get(file).add(start + k);
    }
  }
  return map;
}

const escapeRe = (x) => x.replace(/[$]/g, '\\$');

/** True when the line declares `id` (variable, function, type, key, parameter, column or field). */
export function declares(line, id, ext) {
  const e = escapeRe(id);
  if (ext === '.sql') {
    return new RegExp(`(^\\s*\\[?${e}\\]?\\s+(N?VARCHAR|N?CHAR|N?TEXT|INT|BIGINT|SMALLINT|TINYINT|BIT|DATE|DATETIME2?|DATETIMEOFFSET|TIME|DECIMAL|NUMERIC|FLOAT|REAL|MONEY|UNIQUEIDENTIFIER|VARBINARY)\\b)|\\b(TABLE|VIEW|PROCEDURE|PROC|FUNCTION|INDEX|CONSTRAINT|TRIGGER|SYNONYM|ADD|COLUMN)\\s+(\\[?\\w+\\]?\\.)*\\[?${e}\\]?(\\W|$)`, 'i').test(line);
  }
  if (ext === '.prisma') {
    return new RegExp(`^\\s*(model|enum|view)\\s+${e}\\b|^\\s*${e}\\s+[A-Z]\\w*|@@?map\\(\\s*(name:\\s*)?"${e}"|\\bmap:\\s*"${e}"`).test(line);
  }
  return new RegExp(`\\b(const|let|var|function|class|type|interface|enum|namespace)\\s+${e}(?![\\w$])|(^\\s*|[{,(]\\s*|^\\s*(readonly|public|private|protected|static)\\s+)${e}\\s*\\??\\s*:(?!:)`).test(line);
}

function check(words, base) {
  const baseline = loadBaseline();
  const mergeBase = git(['merge-base', base, 'HEAD']).trim();
  const added = addedLines(mergeBase);
  const status = git(['diff', '--name-status', '-M', `${mergeBase}...HEAD`]).split('\n').filter(Boolean);
  const newFiles = new Set();
  const renamedFrom = new Map();
  for (const l of status) {
    const [st, a, b] = l.split('\t');
    if (st.startsWith('A')) newFiles.add(a);
    if (st.startsWith('R')) { newFiles.add(b); renamedFrom.set(b, a); }
  }
  const baseTree = new Set(git(['ls-tree', '-r', '-t', '--name-only', mergeBase]).split('\n').filter(Boolean));
  const errors = [];

  for (const file of newFiles) {
    if (isIgnored(file)) continue;
    // Only path segments that are new (the folder or file did not exist in the base).
    const parts = file.split('/');
    for (let k = 0; k < parts.length; k++) {
      const prefix = parts.slice(0, k + 1).join('/');
      if (baseTree.has(prefix)) continue;
      const old = renamedFrom.get(file);
      for (const s of spanishSegments(parts[k], words)) {
        if (baseline.paths.has(s.segment) || (old && old.split('/').includes(parts[k]))) continue;
        errors.push(`${prefix}: Spanish file or folder name "${s.segment}" (word: ${s.why})`);
      }
    }
  }

  for (const [file, lines] of added) {
    if (!isChecked(file) || !lines.size || !existsSync(file)) continue;
    const ext = path.extname(file);
    const src = readFileSync(file, 'utf8');
    const rawLines = src.split('\n');
    const lx = lexFile(file, src);
    // Names that the same file already had in the base: always allowed.
    let before = new Set();
    const oldPath = renamedFrom.get(file) ?? (newFiles.has(file) ? null : file);
    if (oldPath) {
      try {
        const old = lexFile(oldPath, git(['show', `${mergeBase}:${oldPath}`]));
        before = new Set(Object.values(old.idents).flat());
      } catch { /* file did not exist */ }
    }
    for (const ln of lines) {
      const raw = rawLines[ln - 1] ?? '';
      const ignoreLine = raw.includes('english-check-ignore');
      const seen = new Set();
      for (const id of ignoreLine ? [] : lx.idents[ln] ?? []) {
        if (seen.has(id) || before.has(id)) continue;
        seen.add(id);
        const why = spanishReason(id, words);
        if (!why) continue;
        const isDecl = declares(raw, id, ext);
        // Database names may be used anywhere; legacy code names may be used but not declared again.
        if (!isDecl && (baseline.db.has(id) || baseline.code.has(id))) continue;
        if (isDecl && !DB_EXT.has(ext) && baseline.db.has(id) && /:/.test(raw)) continue; // key that mirrors a DB column
        errors.push(`${file}:${ln}: Spanish identifier "${id}" (word: ${why})${isDecl ? ' declared' : ''}`);
      }
      const cm = lx.comments[ln];
      if (cm && !ignoreLine && isSpanishProse(cm)) errors.push(`${file}:${ln}: Spanish comment "${cm.slice(0, 80)}"`);
    }
  }

  if (errors.length) {
    console.error(`\nEnglish-only rule: ${errors.length} problem(s) in lines added vs ${base}.`);
    console.error('Code, comments, file names and DB objects must be in English. Only user-facing UI text stays in Spanish.\n');
    for (const e of errors) console.error(`  ${e}`);
    console.error('\nRename to English. See AGENTS.md ("Language of code").');
    console.error('Legacy names (scripts/ci/english-identifiers-baseline.txt) may be used, not declared again.');
    console.error('Last resort for a legacy contract (API field, env var): add the comment `english-check-ignore: <reason>` on that line.');
    process.exit(1);
  }
  console.log(`English-only rule: OK (lines added vs ${base}).`);
}

function checkText(text, label = 'text') {
  if (isSpanishProse(text)) {
    console.error(`English-only rule: the ${label} reads as Spanish. Write it in English:\n  ${text}`);
    process.exit(1);
  }
  console.log(`English-only rule: ${label} OK.`);
}

// ---------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const val = (flag) => { const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1]; };
  const words = loadWords();
  if (args.includes('--write-baseline')) writeBaseline(words);
  else if (args.includes('--inventory')) inventory(words, val('--json'));
  else if (args.includes('--text')) checkText(val('--text') ?? '', val('--label') ?? 'text');
  else check(words, val('--base') ?? (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/testing'));
}
