// Gotcha del 2026-10-21 (conversación 123 de Proyectos, prod): tras un `cd codigo/<repo>`
// persistente, `Write(./codigo/**)` dejó de coincidir y el Write quedó negado.
// Arreglo doble: reglas Edit/Write con la ruta ABSOLUTA del hilo («//ruta/**») y
// CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1 en el entorno del hijo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permisosCodigo, permisosTerminalCompleta, reglasEscrituraAbsolutas } from '../src/codigo.mjs';
import { prepararCodigoTurno } from '../src/puente.mjs';
import { armarArgumentos, armarEntorno } from '../src/claude.mjs';

const CWD = '/Users/horus/.puente-hilos/horus-prod/proyectos/1/conversaciones/123';
const repo = { nombre: 'sapsend', github: 'gsslatam/sapsend', clon: '/x/sapsend', ramaPruebas: 'testing', ramaProduccion: 'production', ramasProtegidas: ['main', 'testing', 'production'], workflowsProduccion: [], stubsPruebas: {}, despliegue: '', descripcion: '' };
const NICO = 'nicolas.rivera@gsslatam.com';
const msg = (email, body = 'mire sapsend') => ({ id: 1, body, author: { kind: 'user', email } });
const ABSOLUTAS = [`Edit(/${CWD}/codigo/**)`, `Write(/${CWD}/codigo/**)`, `Edit(/${CWD}/trabajo/**)`, `Write(/${CWD}/trabajo/**)`];

test('reglasEscrituraAbsolutas: «//» + ruta del hilo para codigo/** y trabajo/**', () => {
  const r = reglasEscrituraAbsolutas(CWD);
  for (const a of ABSOLUTAS) assert.ok(r.includes(a), `falta ${a}`);
  assert.ok(r.every((x) => /^(Edit|Write)\(\/\/Users\//.test(x)));
});

test('reglasEscrituraAbsolutas falla cerrado con rutas raras o relativas', () => {
  assert.deepEqual(reglasEscrituraAbsolutas(null), []);
  assert.deepEqual(reglasEscrituraAbsolutas('relativa/123'), []);
  assert.deepEqual(reglasEscrituraAbsolutas('/tmp/con espacio'), []);
  assert.deepEqual(reglasEscrituraAbsolutas('/tmp/x/**'), []);
  assert.deepEqual(reglasEscrituraAbsolutas('/tmp/x)'), []);
});

test('permisosCodigo: conserva las reglas relativas y suma las absolutas', () => {
  const p = permisosCodigo({ repos: [{ ...repo, worktree: `${CWD}/codigo/sapsend` }], autorizado: false, pases: true, cwd: CWD });
  assert.ok(p.permitidas.includes('Edit(./codigo/**)'));
  assert.ok(p.permitidas.includes('Write(./codigo/**)'));
  for (const a of ABSOLUTAS) assert.ok(p.permitidas.includes(a), `falta ${a}`);
  // Sin cwd, como antes: solo relativas.
  const sin = permisosCodigo({ repos: [repo], autorizado: false, pases: true });
  assert.ok(!sin.permitidas.some((x) => x.includes('//')));
});

test('permisosTerminalCompleta también lleva las absolutas', () => {
  const p = permisosTerminalCompleta({ repos: [{ ...repo, worktree: `${CWD}/codigo/sapsend` }], pases: true, cwd: CWD });
  for (const a of ABSOLUTAS) assert.ok(p.permitidas.includes(a), `falta ${a}`);
});

const vinculos = (terminalCompleta) => ({ operadores: [NICO], repos: new Map([['sapsend', repo]]), proyectos: new Map([[1, { repos: ['sapsend'], nivel: 2, pases: true, bajoDemanda: true, terminalCompleta }]]) });
const comun = (terminalCompleta) => ({
  cargar: () => vinculos(terminalCompleta),
  leerToken: () => 'ghp_x',
  prepararHome: () => '/h/home-codigo',
  preparar: ({ repos }) => repos.map((r) => ({ ...r, worktree: `${CWD}/codigo/${r.nombre}`, rama: 'proyecto/1-c123', gitComun: '/x/.git', dependencias: 'instaladas' })),
  elegirRepos: () => [repo],
});
const cfg = { rutaReposPorProyecto: '/x.json', githubTokenArchivo: '/t', hilosDir: '/h', home: '/Users/horus', path: '/usr/bin' };

for (const [nombre, terminal, autor] of [['sandbox (no operador)', false, 'otra@gsslatam.com'], ['terminal completa (operador)', true, NICO]]) {
  test(`turno armado de punta a punta, ${nombre}: --allowedTools lleva las absolutas`, () => {
    const c = prepararCodigoTurno({ cfg, idProject: 1, idConversation: 123, rutas: { cwd: CWD }, lote: [msg(autor)], agenteNombre: 'Orus', ...comun(terminal) });
    const args = armarArgumentos({ perfil: { mcpServers: {}, herramientas: [], web: false }, sesion: { id: '00000000-0000-0000-0000-000000000123', nueva: true }, rutaMcp: '/m', rutaSistema: '/s', codigo: c });
    const ini = args.indexOf('--allowedTools');
    const fin = args.indexOf('--disallowedTools');
    const permitidas = args.slice(ini + 1, fin);
    for (const a of ['Edit(./codigo/**)', 'Write(./codigo/**)', 'Write(./trabajo/**)', ...ABSOLUTAS]) assert.ok(permitidas.includes(a), `falta ${a}`);
    // Ninguna regla de escritura sobre la carpeta del hilo quedó negada.
    const negadas = args.slice(fin + 1, args.indexOf('--strict-mcp-config'));
    assert.ok(!negadas.some((x) => /^(Edit|Write)\(/.test(x)));
  });
}

test('el entorno del hijo SIEMPRE lleva CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1 (con y sin código)', () => {
  const base = { path: '/bin', home: '/h', configClaudeDir: '/c', credencial: { tipo: 'oauth-token', valor: 't' } };
  assert.equal(armarEntorno(base).CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR, '1');
  assert.equal(armarEntorno(base, { simultaneos: 2 }, { GH_TOKEN: 'g', HOME: '/hc' }).CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR, '1');
});
