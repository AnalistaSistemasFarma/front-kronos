import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { cargarConfig } from '../src/config.mjs';
import { AGENT_NOTE_FILE, INDEX_FILE, logLine, noteProjectId, prepareVaultTurn, projectSlug, updateProjectNote, vaultHeaderText } from '../src/vault-proyectos.mjs';

function context(over = {}) {
  return {
    project: {
      idProject: 39,
      name: 'Feature - Proyectos Synerlink',
      description: 'Mejoras del módulo',
      instructions: 'Mejorar los proyectos de SynerLink',
      company: { companyName: 'GSS' },
      profile: { label: 'Farmalógica' },
      files: [],
      links: { emails: [{ subject: 'Correo X', senderName: 'Ana' }], requests: [{ idRequest: 7, subject: 'Solicitud Y', estado: 'Abierta' }] },
      schedule: {
        hoy: '2026-11-26',
        members: ['Nicolás Rivera'],
        tasks: [{ id: 1, title: 'Tarea | uno', startDate: '2026-11-01', endDate: '2026-11-10', status: 'en_curso', progress: 40, responsible: 'Nicolás Rivera' }],
        requests: [],
      },
      ...over,
    },
    conversation: { title: 'Principal' },
  };
}

function setup() {
  const base = mkdtempSync(path.join(tmpdir(), 'vault-proy-'));
  const dir = path.join(base, 'vault', 'proyectos', 'synerlink');
  const cwd = path.join(base, 'hilo');
  const rutas = { trabajo: path.join(cwd, 'trabajo'), contexto: path.join(cwd, 'contexto') };
  mkdirSync(rutas.trabajo, { recursive: true });
  mkdirSync(rutas.contexto, { recursive: true });
  return { base, dir, rutas };
}

const lote = [{ body: 'Organice el proyecto', author: { name: 'Nicolás Rivera', email: 'n@x.com' } }];
const now = new Date('2026-11-26T14:00:00Z');

test('projectSlug is stable and safe', () => {
  assert.equal(projectSlug('Feature - Proyectos Synerlink', 39), 'feature-proyectos-synerlink');
  assert.equal(projectSlug('Migración SGD → SynerLink', 3), 'migracion-sgd-synerlink');
  assert.equal(projectSlug('../../', 5), 'proyecto-5');
});

test('creates the note and the index with card, log and state placeholder', () => {
  const { dir, rutas } = setup();
  const prep = prepareVaultTurn({ dir, rutas, contexto: context() });
  assert.equal(prep.ok, true);
  assert.match(readFileSync(path.join(rutas.contexto, 'nota-proyecto.md'), 'utf8'), /todavía no/);
  const r = updateProjectNote({ dir, rutas, contexto: context(), agent: 'Orus', idConversation: 205, lote, reply: 'Listo.\nMEDIA:trabajo/x.csv', now });
  assert.equal(r.ok, true);
  const text = readFileSync(r.file, 'utf8');
  assert.equal(noteProjectId(text), 39);
  assert.match(text, /# Feature - Proyectos Synerlink/);
  assert.match(text, /Tarea \/ uno/);
  assert.match(text, /Solicitud #7/);
  assert.match(text, /«Principal» \(#205\)/);
  assert.match(text, /Nicolás Rivera: Organice el proyecto → Listo\./);
  assert.doesNotMatch(text, /MEDIA:/);
  const index = readFileSync(path.join(dir, INDEX_FILE), 'utf8');
  assert.match(index, /\[\[feature-proyectos-synerlink\\\|Feature - Proyectos Synerlink\]\]/);
});

test('the agent state replaces the previous one; own notes are kept; log grows newest first', () => {
  const { dir, rutas } = setup();
  updateProjectNote({ dir, rutas, contexto: context(), agent: 'Orus', idConversation: 205, lote, reply: 'uno', now });
  const file = path.join(dir, 'feature-proyectos-synerlink.md');
  const own = readFileSync(file, 'utf8').replace('_Espacio libre: el puente nunca modifica esta sección._', 'Nota escrita a mano');
  writeFileSync(file, own);
  writeFileSync(path.join(rutas.trabajo, AGENT_NOTE_FILE), '### Objetivo\nOrdenar\n### Pendientes\n- PR (Orus)');
  const r = updateProjectNote({ dir, rutas, contexto: context({ name: 'Proyecto renombrado' }), agent: 'Orus', idConversation: 206, lote, reply: 'dos', now: new Date('2026-11-26T15:00:00Z') });
  assert.equal(r.stateUpdated, true);
  assert.equal(r.file, file, 'found again by id after a rename');
  assert.equal(existsSync(path.join(rutas.trabajo, AGENT_NOTE_FILE)), false);
  const text = readFileSync(file, 'utf8');
  assert.match(text, /### Objetivo\nOrdenar/);
  assert.match(text, /Nota escrita a mano/);
  assert.ok(text.indexOf('→ dos') < text.indexOf('→ uno'));
  assert.match(text, /#205/);
  assert.match(text, /#206/);
  // Without a new state file the state is kept.
  prepareVaultTurn({ dir, rutas, contexto: context() });
  assert.match(readFileSync(path.join(rutas.contexto, 'nota-proyecto.md'), 'utf8'), /Ordenar/);
  updateProjectNote({ dir, rutas, contexto: context(), agent: 'Orus', idConversation: 205, lote, reply: 'tres', now });
  assert.match(readFileSync(file, 'utf8'), /### Objetivo\nOrdenar/);
});

test('secrets are never written', () => {
  const { dir, rutas } = setup();
  writeFileSync(path.join(rutas.trabajo, AGENT_NOTE_FILE), 'token ghp_abcdefghijklmnopqrstuvwxyz0123');
  const r = updateProjectNote({ dir, rutas, contexto: context(), agent: 'Orus', idConversation: 205, lote: [{ body: 'password=Abc12345xyz', author: { name: 'X' } }], reply: 'ok', now });
  assert.equal(r.ok, true);
  assert.match(r.reason, /secret/);
  const text = readFileSync(r.file, 'utf8');
  assert.doesNotMatch(text, /ghp_|Abc12345xyz/);
  assert.match(text, /omitido/);
});

test('a symlinked note is not followed', () => {
  const { base, dir, rutas } = setup();
  mkdirSync(dir, { recursive: true });
  const outside = path.join(base, 'fuera.md');
  writeFileSync(outside, 'original');
  symlinkSync(outside, path.join(dir, 'feature-proyectos-synerlink.md'));
  const r = updateProjectNote({ dir, rutas, contexto: context(), agent: 'Orus', idConversation: 205, lote, reply: 'x', now });
  assert.equal(readFileSync(outside, 'utf8'), 'original');
  assert.ok(!r.ok || r.file !== path.join(dir, 'feature-proyectos-synerlink.md'));
});

test('off without a folder; never throws', () => {
  const { rutas } = setup();
  assert.equal(prepareVaultTurn({ dir: null, rutas, contexto: context() }).ok, false);
  assert.equal(updateProjectNote({ dir: null, rutas, contexto: context() }).ok, false);
  assert.equal(updateProjectNote({ dir: 'relativo', rutas, contexto: context() }).ok, false);
  assert.equal(vaultHeaderText({ file: null }), '');
  assert.match(vaultHeaderText({ file: '/v/p.md' }), /nota-proyecto\.md/);
});

test('a backfill without messages adds no log line', () => {
  const { dir, rutas } = setup();
  const r = updateProjectNote({ dir, rutas, contexto: context(), agent: 'Orus', idConversation: 205, lote: [], reply: '', now });
  assert.equal(r.ok, true);
  assert.doesNotMatch(readFileSync(r.file, 'utf8'), /^- \*\*\d{4}-/m);
});

test('logLine trims long text', () => {
  const l = logLine({ when: '2026-11-26 09:00', conversationTitle: 'P', authors: 'A', request: 'x'.repeat(1000), reply: 'y'.repeat(1000) });
  assert.ok(l.length < 900);
});

test('config: explicit folder, off, and relative rejected', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'vault-cfg-'));
  assert.equal(cargarConfig(baseEnv(base, { HILOS_VAULT_PROYECTOS_DIR: path.join(base, 'v') })).vaultProyectos.dir, path.join(base, 'v'));
  assert.equal(cargarConfig(baseEnv(base, { HILOS_VAULT_PROYECTOS_DIR: 'no' })).vaultProyectos, null);
  assert.equal(cargarConfig(baseEnv(base)).vaultProyectos, null);
  assert.throws(() => cargarConfig(baseEnv(base, { HILOS_VAULT_PROYECTOS_DIR: 'relativo' })), /absoluta/);
});

function baseEnv(dir, extra = {}) {
  const perfiles = path.join(dir, 'perfiles.json');
  writeFileSync(perfiles, JSON.stringify({ farmalogica: { mcpServers: { s: { type: 'http', url: 'http://x/mcp' } }, herramientas: ['mcp__s__sap_query'] } }));
  return {
    HILOS_ENTORNO: 'pruebas',
    HILOS_SYNERLINK_URL: 'http://pruebas.local:3070/',
    HILOS_SYNERLINK_KEY: 'k'.repeat(40),
    HILOS_AGENTE: 'Play',
    HILOS_DIR: path.join(dir, 'puente'),
    HILOS_PERFILES: perfiles,
    HILOS_ANTHROPIC_API_KEY: 'sk-test',
    ...extra,
  };
}
