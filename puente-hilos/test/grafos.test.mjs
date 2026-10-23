import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armarArgumentos, armarEntorno } from '../src/claude.mjs';
import { permisosCodigo } from '../src/codigo.mjs';
import { grafosDelTurno, permisosGrafos, textoGrafos } from '../src/grafos.mjs';

const perfil = { mcpServers: {}, herramientas: [], web: false };
const base = { perfil, sesion: { id: '11111111-2222-3333-4444-555555555555', nueva: true }, rutaMcp: '/m.json', rutaSistema: '/s.md' };

test('sin plugins no hay Skill ni --plugin-dir (comportamiento anterior)', () => {
  const a = armarArgumentos(base);
  assert.ok(!a.includes('--plugin-dir'));
  assert.ok(!a[a.indexOf('--tools') + 1].split(',').includes('Skill'));
});

test('con plugins: --plugin-dir, herramienta Skill y grafos en --add-dir', () => {
  const a = armarArgumentos({ ...base, plugins: { dirs: ['/p/graphify'], dirsLectura: ['/g/sapsend/graphify-out'] } });
  assert.equal(a[a.indexOf('--plugin-dir') + 1], '/p/graphify');
  assert.ok(a[a.indexOf('--tools') + 1].split(',').includes('Skill'));
  assert.ok(a.includes('/g/sapsend/graphify-out'));
  assert.equal(a[a.indexOf('/g/sapsend/graphify-out') - 1], '--add-dir');
  // Los grafos no quedan escribibles: Edit/Write siguen solo en ./trabajo.
  assert.ok(!a.some((x) => /^(Edit|Write)\(\/g/.test(x)));
});

test('el entorno del hijo fuerza Graphify local', () => {
  const env = armarEntorno({ path: '/bin', home: '/h', configClaudeDir: '/c', credencial: { tipo: 'oauth-token', valor: 't' } });
  assert.equal(env.GRAPHIFY_BACKEND, 'none');
  assert.equal(env.GRAPHIFY_QUERY_LOG_DISABLE, '1');
  assert.ok(!('OPENAI_API_KEY' in env) && !('GEMINI_API_KEY' in env));
});

test('turno con código: solo consultas de graphify; update/label/install negados', () => {
  const p = permisosCodigo({ repos: [{ nombre: 'sapsend', worktree: '/w/sapsend', workflowsProduccion: [] }], autorizado: false, pases: false });
  assert.ok(p.permitidas.includes('Bash(graphify query *)'));
  assert.ok(!p.permitidas.some((r) => /graphify (update|label|install)/.test(r)));
  assert.ok(p.prohibidas.includes('Bash(graphify label *)'));
  assert.ok(p.prohibidas.includes('Bash(graphify install *)'));
  assert.deepEqual(permisosGrafos().permitidas.length, 5);
});

test('grafosDelTurno: solo repos montados con graph.json, nombres seguros', () => {
  const existe = (r) => r === '/g/sapsend/graphify-out/graph.json';
  const g = grafosDelTurno('/g', [{ nombre: 'sapsend' }, { nombre: 'front-kronos' }, { nombre: '../x' }], existe, () => 'afc156a\n');
  assert.deepEqual(g, [{ nombre: 'sapsend', dir: '/g/sapsend/graphify-out', commit: 'afc156a' }]);
  assert.deepEqual(grafosDelTurno(null, [{ nombre: 'sapsend' }]), []);
  assert.match(textoGrafos(g, { conBash: true }), /GRAPH_REPORT\.md/);
  assert.equal(textoGrafos([]), '');
});
