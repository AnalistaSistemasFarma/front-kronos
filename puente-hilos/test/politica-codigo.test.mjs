import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarReposPorProyecto } from '../src/codigo.mjs';
import { jsonParaCodigo, resolverPolitica, validarPoliticaApi } from '../src/politica.mjs';

/*
 * Integración «permisos de los agentes» (PR #702) + «acceso al código» (PR #699): lo que
 * entrega jsonParaCodigo lo acepta tal cual validarReposPorProyecto, y la base manda sobre
 * el archivo manual (incluso para revocar).
 */
const ARCHIVO = {
  operadoresPases: ['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com'],
  repos: {
    sapsend: { github: 'gsslatam/sapsend', clon: '/tmp/repos/sapsend', ramaPruebas: 'testing', ramaProduccion: 'production', workflowsProduccion: ['deploy-olp.yml'] },
  },
  proyectos: { 1: { repos: ['sapsend'], nivel: 2, pases: true } },
};
const dto = (extra = {}) => ({
  idProject: 1,
  source: 'bd',
  codeLevel: 'desarrollo',
  level: 2,
  deploys: false,
  repos: [{ slug: 'sapsend', name: 'SAPSEND', github: 'gsslatam/sapsend', branchTesting: 'testing', branchProduction: 'production' }],
  deployApprovers: [],
  connectors: [],
  ...extra,
});

test('la base en «desarrollo» (sin pases): codigo.mjs recibe el proyecto SIN pases aunque el archivo diga pases', () => {
  const politica = resolverPolitica({ api: { estado: 'bd', politica: validarPoliticaApi(dto(), 1) }, archivo: ARCHIVO, idProject: 1 });
  const v = validarReposPorProyecto(jsonParaCodigo(politica, ARCHIVO, 1));
  assert.deepEqual(v.proyectos.get(1), { repos: ['sapsend'], nivel: 2, pases: false, bajoDemanda: false });
  assert.equal(v.repos.get('sapsend').clon, '/tmp/repos/sapsend');
  assert.deepEqual(v.repos.get('sapsend').workflowsProduccion, ['deploy-olp.yml']);
});

test('la base en «ninguno» revoca lo del archivo: no hay código', () => {
  const politica = resolverPolitica({
    api: { estado: 'bd', politica: validarPoliticaApi(dto({ codeLevel: 'ninguno', level: 0, repos: [] }), 1) },
    archivo: ARCHIVO,
    idProject: 1,
  });
  assert.equal(jsonParaCodigo(politica, ARCHIVO, 1), null);
});

test('sin política en la base: el archivo manual, igual que antes (pases incluidos)', () => {
  const politica = resolverPolitica({ api: { estado: 'sin-politica' }, archivo: ARCHIVO, idProject: 1 });
  const v = validarReposPorProyecto(jsonParaCodigo(politica, ARCHIVO, 1));
  assert.deepEqual(v.proyectos.get(1), { repos: ['sapsend'], nivel: 2, pases: true, bajoDemanda: false });
  assert.deepEqual(v.operadores, ['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com']);
});

test('pases desde la base: solo los autorizadores que el Mac también declara', () => {
  const politica = resolverPolitica({
    api: { estado: 'bd', politica: validarPoliticaApi(dto({ codeLevel: 'desarrollo_pases', level: 3, deploys: true, deployApprovers: ['cristian.baldion@gsslatam.com'] }), 1) },
    archivo: ARCHIVO,
    idProject: 1,
  });
  const v = validarReposPorProyecto(jsonParaCodigo(politica, ARCHIVO, 1));
  assert.deepEqual(v.operadores, ['cristian.baldion@gsslatam.com']);
  assert.equal(v.proyectos.get(1).pases, true);
});

test('bajo demanda: jsonParaCodigo conserva el «bajoDemanda» del archivo local del proyecto', () => {
  const archivo = { ...ARCHIVO, proyectos: { 1: { ...ARCHIVO.proyectos[1], bajoDemanda: true } } };
  const politica = resolverPolitica({ api: { estado: 'sin-politica' }, archivo, idProject: 1 });
  const v = validarReposPorProyecto(jsonParaCodigo(politica, archivo, 1));
  assert.equal(v.proyectos.get(1).bajoDemanda, true);
});
