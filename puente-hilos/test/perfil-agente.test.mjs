import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cargarConfig } from '../src/config.mjs';
import { prepararCodigoTurno } from '../src/puente.mjs';
import { validarReposPorProyecto } from '../src/codigo.mjs';
import { resolverComando, textoAyuda } from '../src/comandos.mjs';
import { textoMemoria } from '../src/memoria.mjs';
import { esNegocio, perfilListo, textoPerfilNegocio } from '../src/perfil-agente.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'puente-perfil-'));
function envBase(dir, extra = {}) {
  const perfiles = path.join(dir, 'perfiles.json');
  writeFileSync(perfiles, JSON.stringify({ farmalogica: { mcpServers: { s: { type: 'http', url: 'http://x/mcp' } }, herramientas: ['mcp__s__sap_query'] } }));
  return {
    HILOS_ENTORNO: 'pruebas',
    HILOS_SYNERLINK_URL: 'http://pruebas.local:3070/',
    HILOS_SYNERLINK_KEY: 'k'.repeat(40),
    HILOS_AGENTE: 'play',
    HILOS_DIR: path.join(dir, 'puente'),
    HILOS_PERFILES: perfiles,
    HILOS_ANTHROPIC_API_KEY: 'sk-test',
    ...extra,
  };
}
const msj = (body, email = 'silvia.quintana@gsslatam.com') => ({ body, author: { kind: 'user', email, name: 'Silvia' } });

test('perfil: sin HILOS_PERFIL es «desarrollo» (Orus y Pedro no cambian)', () => {
  const cfg = cargarConfig(envBase(tmp()));
  assert.equal(cfg.perfilAgente, 'desarrollo');
  assert.equal(cfg.enfoque, null);
  assert.equal(esNegocio(cfg), false);
  assert.match(perfilListo(cfg), /^desarrollo/);
  // Con repos (horus-prod) sigue igual.
  const c2 = cargarConfig(envBase(tmp(), { HILOS_REPOS_POR_PROYECTO: '/x/repos.json', HILOS_GRAFOS_DIR: '/x/grafos' }));
  assert.equal(c2.perfilAgente, 'desarrollo');
  assert.equal(c2.rutaReposPorProyecto, '/x/repos.json');
});

test('perfil «negocio»: valida valores, enfoque de una línea y rechaza variables de código', () => {
  const cfg = cargarConfig(envBase(tmp(), { HILOS_PERFIL: ' Negocio ', HILOS_ENFOQUE: 'comercio exterior y compras internacionales' }));
  assert.equal(cfg.perfilAgente, 'negocio');
  assert.equal(cfg.enfoque, 'comercio exterior y compras internacionales');
  assert.match(perfilListo(cfg), /negocio \(sin código ni repositorios.*enfoque: comercio exterior/);
  assert.throws(() => cargarConfig(envBase(tmp(), { HILOS_PERFIL: 'ventas' })), /HILOS_PERFIL solo admite desarrollo o negocio/);
  for (const v of ['HILOS_REPOS_POR_PROYECTO', 'HILOS_GITHUB_TOKEN_ARCHIVO', 'HILOS_GRAFOS_DIR']) {
    assert.throws(() => cargarConfig(envBase(tmp(), { HILOS_PERFIL: 'negocio', [v]: '/x/y' })), new RegExp(`no lleva código: quite ${v}`));
  }
  assert.throws(() => cargarConfig(envBase(tmp(), { HILOS_ENFOQUE: 'a\nb' })), /una sola línea/);
  assert.throws(() => cargarConfig(envBase(tmp(), { HILOS_ENFOQUE: 'x'.repeat(401) })), /máximo 400/);
});

test('perfil «negocio»: el proyecto con repos vinculados NO monta código (ni índice ni carga del archivo)', () => {
  const vinc = validarReposPorProyecto({
    operadores: ['nicolas.rivera@gsslatam.com'],
    repos: {
      sapsend: { github: 'gsslatam/sapsend', clon: '/h/repos/sapsend', ramaPruebas: 'testing', ramaProduccion: 'main' },
      'front-kronos': { github: 'AnalistaSistemasFarma/front-kronos', clon: '/h/repos/front-kronos', ramaPruebas: 'testing', ramaProduccion: 'main' },
    },
    proyectos: { 9: { repos: ['sapsend', 'front-kronos'], nivel: 2, pases: false, bajoDemanda: true } },
  });
  let cargas = 0;
  const comun = {
    idProject: 9,
    idConversation: 144,
    rutas: { cwd: '/no/existe/c144', puente: '/no/existe/c144/.puente' },
    lote: [msj('revise front-kronos y sapsend')],
    agenteNombre: 'Play',
    cargar: () => (cargas++, vinc),
    leerToken: () => 'tok',
    prepararHome: () => '/h/home-codigo',
    preparar: ({ repos }) => repos.map((r) => ({ ...r, worktree: `/no/existe/c144/codigo/${r.nombre}`, rama: 'proyecto/9-c144', gitComun: `${r.clon}/.git` })),
  };
  const base = { rutaReposPorProyecto: '/x.json', githubTokenArchivo: '/t', hilosDir: '/h', home: '/home', path: '/bin' };
  // Negocio: null, sin siquiera leer el archivo de repos (aunque viniera configurado).
  assert.equal(prepararCodigoTurno({ ...comun, cfg: { ...base, perfilAgente: 'negocio' } }), null);
  assert.equal(prepararCodigoTurno({ ...comun, cfg: { ...base, perfilAgente: 'negocio' }, completo: true }), null);
  assert.equal(cargas, 0);
  // Desarrollo (igual que hoy): con los mismos repos sí hay código.
  const dev = prepararCodigoTurno({ ...comun, cfg: { ...base, perfilAgente: 'desarrollo' } });
  assert.ok(dev && !dev.soloIndice);
  assert.match(dev.bloque, /usted SÍ tiene el código/);
  // Sin perfil (config vieja) = desarrollo.
  assert.ok(prepararCodigoTurno({ ...comun, cfg: base }));
});

test('perfil «negocio»: encabezado con el enfoque y sin ofrecer código', () => {
  const t = textoPerfilNegocio({ agente: 'Play', enfoque: 'comercio exterior y compras internacionales' });
  assert.match(t, /## Su enfoque en este proyecto \(perfil de negocio\)/);
  assert.match(t, /Usted es Play, asistente de negocio: comercio exterior y compras internacionales\./);
  assert.match(t, /NO es un asistente de desarrollo/);
  assert.match(t, /repositorios o un nivel de acceso al código, no aplican a usted/);
  assert.match(textoPerfilNegocio({ agente: 'Ofi' }), /Usted es Ofi, asistente de negocio\. Trabaje/);
});

test('perfil «negocio»: /ayuda sin skills de código y /code-review responde que no aplica', () => {
  const dev = textoAyuda({});
  for (const n of ['code-review', 'simplify', 'security-review', 'verify', 'claude-api']) assert.match(dev, new RegExp('`/' + n + '`'));
  const neg = textoAyuda({ negocio: true });
  for (const n of ['code-review', 'simplify', 'security-review', 'verify', 'claude-api']) assert.doesNotMatch(neg, new RegExp('`/' + n + '`'));
  assert.match(neg, /`\/dataviz`/);
  assert.match(neg, /`\/deep-research`/);
  const r = resolverComando({ lote: [msj('/code-review')], negocio: true, agente: 'Play' });
  assert.equal(r.accion, 'responder');
  assert.match(r.texto, /\*\*\/code-review\*\* no está disponible.*Play trabaja en este proyecto con perfil de negocio/s);
  assert.equal(resolverComando({ lote: [msj('/ayuda')], negocio: true }).texto, neg);
  // En desarrollo, igual que antes.
  assert.equal(resolverComando({ lote: [msj('/code-review')] }).accion, 'nativo');
  assert.equal(resolverComando({ lote: [msj('/dataviz')], negocio: true }).accion, 'nativo');
});

test('perfil «negocio»: la memoria no habla de ramas, pases ni servidores; en desarrollo, igual que antes', () => {
  const comun = { agente: 'Play', indice: '- [x](x.md)', archivos: ['x.md'], excluidos: [] };
  const neg = textoMemoria({ ...comun, negocio: true });
  assert.doesNotMatch(neg, /ramas, pases|flujos de desarrollo|gotchas de servidores/);
  assert.match(neg, /memoria que Play ha acumulado en su chat/);
  const dev = textoMemoria(comun);
  assert.match(dev, /flujos de desarrollo y despliegue, gotchas de servidores/);
  assert.equal(dev, textoMemoria({ ...comun, negocio: false }));
});
