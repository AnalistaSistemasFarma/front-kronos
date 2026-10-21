import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permisosTerminalCompleta, permisosCodigo, textoTerminalCompleta, validarReposPorProyecto } from '../src/codigo.mjs';
import { prepararCodigoTurno } from '../src/puente.mjs';
import { armarArgumentos } from '../src/claude.mjs';

const repo = { nombre: 'sapsend', github: 'gsslatam/sapsend', clon: '/x/sapsend', ramaPruebas: 'testing', ramaProduccion: 'production', ramasProtegidas: ['main', 'testing', 'production'], workflowsProduccion: [], stubsPruebas: {}, despliegue: '', descripcion: '' };
const NICO = 'nicolas.rivera@gsslatam.com';
const msg = (email) => ({ id: 1, body: 'hola', author: { kind: 'user', email } });

test('validar: terminalCompleta debe ser booleano', () => {
  const base = { operadoresPases: [NICO], repos: { sapsend: { github: 'gsslatam/sapsend', clon: '/x/sapsend', ramaPruebas: 'testing', ramaProduccion: 'production' } }, proyectos: { 1: { repos: ['sapsend'], nivel: 2, terminalCompleta: true } } };
  assert.equal(validarReposPorProyecto(base).proyectos.get(1).terminalCompleta, true);
  base.proyectos[1].terminalCompleta = 'si';
  assert.throws(() => validarReposPorProyecto(base));
});

test('permisosTerminalCompleta: Bash entero, sin negar ssh, pero conserva la protección de ramas', () => {
  const p = permisosTerminalCompleta({ repos: [{ ...repo, worktree: '/w/sapsend' }], pases: true });
  assert.ok(p.permitidas.includes('Bash'));
  assert.ok(!p.prohibidas.some((r) => /ssh/.test(r)));
  assert.ok(p.prohibidas.some((r) => r.includes('push * --force')));
  assert.ok(p.prohibidas.some((r) => r.includes('--delete-branch')));
  const normal = permisosCodigo({ repos: [{ ...repo, worktree: '/w/sapsend' }], autorizado: false, pases: true });
  assert.ok(normal.prohibidas.includes('Bash(ssh *)'));
});

function cfgFalso() {
  return { rutaReposPorProyecto: '/x.json', githubTokenArchivo: '/t', hilosDir: '/h', home: '/Users/horus', path: '/usr/bin' };
}
const vinculos = { operadores: [NICO], repos: new Map([['sapsend', repo]]), proyectos: new Map([[1, { repos: ['sapsend'], nivel: 2, pases: true, bajoDemanda: true, terminalCompleta: true }]]) };
const comun = { cargar: () => vinculos, leerToken: () => 'ghp_x', prepararHome: () => '/h/home-codigo', preparar: ({ repos }) => repos.map((r) => ({ ...r, worktree: `/w/${r.nombre}`, rama: 'proyecto/1-c9', gitComun: '/x/.git', dependencias: 'instaladas' })), elegirRepos: () => [] };

test('prepararCodigoTurno: operador → terminal completa sin sandbox y con la casa real, aunque no haya repos montados', () => {
  const c = prepararCodigoTurno({ cfg: cfgFalso(), idProject: 1, idConversation: 9, rutas: {}, lote: [msg(NICO)], agenteNombre: 'Orus', ...comun });
  assert.equal(c.terminalCompleta, true);
  assert.equal(c.sandbox.enabled, false);
  assert.equal(c.entorno.HOME, '/Users/horus');
  assert.match(c.bloque, /sesión 3 de serfarma05/);
  const args = armarArgumentos({ perfil: { mcpServers: {}, herramientas: [], web: false }, sesion: { id: '00000000-0000-0000-0000-000000000009', nueva: true }, rutaMcp: '/m', rutaSistema: '/s', codigo: c });
  assert.ok(args.includes('Bash'));
});

test('prepararCodigoTurno: otro autor → como antes (solo índice, sin Bash)', () => {
  const c = prepararCodigoTurno({ cfg: cfgFalso(), idProject: 1, idConversation: 9, rutas: {}, lote: [msg('otra@gsslatam.com')], agenteNombre: 'Orus', ...comun });
  assert.equal(c.soloIndice, true);
  const c2 = prepararCodigoTurno({ cfg: cfgFalso(), idProject: 1, idConversation: 9, rutas: {}, lote: [msg('otra@gsslatam.com')], agenteNombre: 'Orus', ...comun, elegirRepos: () => [repo] });
  assert.notEqual(c2.terminalCompleta, true);
  assert.equal(c2.sandbox.enabled, true);
});

test('el texto de la terminal completa trae las reglas del principal', () => {
  const t = textoTerminalCompleta({ autores: [NICO] });
  for (const r of [/Cristian Baldión/, /SQL directo/, /Service Layer/, /respaldo/, /sesión 3/, /TESTING/, /secretos/]) assert.match(t, r);
});
