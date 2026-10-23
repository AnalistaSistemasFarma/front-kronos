import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  combinarPerfil,
  prepararConectoresTurno,
  textoConectores,
  turnoConConectores,
  validarConectoresPorProyecto,
  verificarSecretos,
} from '../src/conectores.mjs';
import { armarArgumentos, revisarInit } from '../src/claude.mjs';
import { textoSistema } from '../src/hilos.mjs';

const NICO = 'nicolas.rivera@gsslatam.com';
const base = () => ({
  lectores: [NICO, 'cristian.baldion@gsslatam.com'],
  conectores: {
    'sapbo-onelatampharma': { url: 'http://192.168.10.5:3015/mcp', herramientas: ['sap_query', 'sap_get', 'sap_metadata', 'sap_query_view'], descripcion: 'SAP OLP' },
    'sapsend-olp': { url: 'http://192.168.10.5:3030/mcp', herramientas: ['sapsend_metadata'], llave: 'sapsend-olp' },
  },
  proyectos: { 1: { conectores: ['sapbo-onelatampharma', 'sapsend-olp'] } },
});
const msg = (email) => ({ id: 1, body: 'hola', author: { kind: 'user', email } });
const perfilFarma = {
  mcpServers: { 'sapbo-farmalogica': { type: 'http', url: 'http://192.168.10.5:3012/mcp' } },
  herramientas: ['mcp__sapbo-farmalogica__sap_query'],
  web: true,
};

test('validar: rechaza escritura, comodines, cabeceras, credenciales en la URL y lectores vacíos', () => {
  assert.ok(validarConectoresPorProyecto(base()));
  const casos = [
    (j) => (j.conectores['sapbo-onelatampharma'].herramientas = ['sap_create']),
    (j) => (j.conectores['sapbo-onelatampharma'].herramientas = ['sap_*']),
    (j) => (j.conectores['sapbo-onelatampharma'].herramientas = ['kronos_create_request']),
    (j) => (j.conectores['sapbo-onelatampharma'].herramientas = ['proyecto_proponer_tarea']),
    (j) => (j.conectores['sapsend-olp'].headers = { Authorization: 'Bearer x' }),
    (j) => (j.conectores['sapsend-olp'].url = 'http://u:p@192.168.10.5:3030/mcp'),
    (j) => (j.conectores['sapsend-olp'].url = 'file:///etc/passwd'),
    (j) => (j.lectores = []),
    (j) => (j.proyectos[1].conectores = ['no-existe']),
  ];
  for (const cambiar of casos) {
    const j = base();
    cambiar(j);
    assert.throws(() => validarConectoresPorProyecto(j));
  }
});

test('turnoConConectores: solo si TODOS los mensajes son de un lector (identidad del servidor)', () => {
  const lectores = [NICO];
  assert.equal(turnoConConectores([msg(NICO)], lectores), true);
  assert.equal(turnoConConectores([msg('NICOLAS.RIVERA@gsslatam.com')], lectores), true);
  assert.equal(turnoConConectores([msg(NICO), msg('otra@gsslatam.com')], lectores), false);
  assert.equal(turnoConConectores([{ author: { kind: 'agent', email: NICO } }], lectores), false);
  assert.equal(turnoConConectores([], lectores), false);
});

function preparar(lote, json = base()) {
  const dir = mkdtempSync(path.join(tmpdir(), 'conectores-'));
  const secretos = path.join(dir, 'secretos.json');
  writeFileSync(secretos, JSON.stringify({ 'sapsend-olp': 'llave-de-prueba-0123456789' }));
  chmodSync(secretos, 0o600);
  const cfg = { rutaConectoresPorProyecto: path.join(dir, 'c.json'), conectoresSecretos: secretos };
  writeFileSync(cfg.rutaConectoresPorProyecto, JSON.stringify(json));
  return { cfg, dir, secretos, r: prepararConectoresTurno({ cfg, idProject: 1, lote }) };
}

test('prepararConectoresTurno: lector → servidores con headersHelper (sin la llave en la config)', () => {
  const { r, secretos } = preparar([msg(NICO)]);
  assert.equal(r.motivo, null);
  assert.deepEqual(r.servidores.map((s) => s.nombre), ['sapbo-onelatampharma', 'sapsend-olp']);
  const sapsend = r.servidores[1].config;
  assert.ok(sapsend.headersHelper.includes(secretos));
  assert.equal(sapsend.headers, undefined);
  assert.ok(!JSON.stringify(r).includes('llave-de-prueba'));
  assert.match(r.bloque, /filtro de fecha/);
  assert.match(r.bloque, /NUNCA agrupe/);
});

test('prepararConectoresTurno: no lector → sin servidores; otro proyecto → null; sin variable → null', () => {
  const { r } = preparar([msg('otra@gsslatam.com')]);
  assert.equal(r.servidores.length, 0);
  assert.ok(r.motivo);
  const { cfg } = preparar([msg(NICO)]);
  assert.equal(prepararConectoresTurno({ cfg, idProject: 2, lote: [msg(NICO)] }), null);
  assert.equal(prepararConectoresTurno({ cfg: {}, idProject: 1, lote: [msg(NICO)] }), null);
});

test('verificarSecretos: exige 600 y las llaves pedidas', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'secretos-'));
  const f = path.join(dir, 's.json');
  writeFileSync(f, JSON.stringify({ a: 'x'.repeat(20) }));
  chmodSync(f, 0o644);
  assert.throws(() => verificarSecretos(f, ['a']), /600/);
  chmodSync(f, 0o600);
  assert.doesNotThrow(() => verificarSecretos(f, ['a']));
  assert.throws(() => verificarSecretos(f, ['b']), /b/);
  assert.throws(() => verificarSecretos(null, ['a']));
  assert.doesNotThrow(() => verificarSecretos(null, []));
});

test('combinarPerfil + armarArgumentos + revisarInit: herramientas exactas y conectores aceptados', () => {
  const { r } = preparar([msg(NICO)]);
  const perfil = combinarPerfil(perfilFarma, r);
  assert.deepEqual(Object.keys(perfil.mcpServers).sort(), ['sapbo-farmalogica', 'sapbo-onelatampharma', 'sapsend-olp']);
  assert.ok(perfil.herramientas.includes('mcp__sapbo-onelatampharma__sap_query'));
  assert.ok(perfil.herramientas.includes('mcp__sapsend-olp__sapsend_metadata'));
  assert.ok(!perfil.herramientas.some((h) => /\*/.test(h)));
  assert.equal(combinarPerfil(perfilFarma, null), perfilFarma);
  const args = armarArgumentos({ perfil, sesion: { id: '00000000-0000-0000-0000-000000000001', nueva: true }, rutaMcp: '/x/mcp.json', rutaSistema: '/x/s.md' });
  assert.ok(args.includes('mcp__sapbo-onelatampharma__sap_query'));
  // Un conector que no venga del perfil combinado sigue abortando el turno.
  assert.deepEqual(revisarInit({ tools: [], mcp_servers: [{ name: 'sapsend-olp' }] }, perfil), []);
  assert.equal(revisarInit({ tools: [], mcp_servers: [{ name: 'kronos-synerlink' }] }, perfil).length, 1);
});

test('el mcp.json del hilo NO trae la llave y el encabezado trae las reglas', () => {
  const { r } = preparar([msg(NICO)]);
  const perfil = combinarPerfil(perfilFarma, r);
  const mcp = JSON.stringify({ mcpServers: perfil.mcpServers });
  assert.ok(!mcp.includes('llave-de-prueba'));
  assert.match(mcp, /headersHelper/);
  const contexto = { project: { idProject: 1, name: 'P', company: { companyName: 'GSS' }, profile: { label: 'Farmalógica', key: 'farmalogica' }, instructions: '' } };
  const sis = textoSistema({ agente: 'Orus', contexto, instruccionesEn: 'system-prompt', bloqueConectores: r.bloque });
  assert.match(sis, /SOLO LECTURA/);
  assert.match(sis, /sapbo-onelatampharma/);
});

test('cabeceras-conector.mjs: imprime la cabecera; falla cerrado sin 600 o sin llave', () => {
  const script = fileURLToPath(new URL('../src/cabeceras-conector.mjs', import.meta.url));
  const { secretos } = preparar([msg(NICO)]);
  const out = execFileSync(process.execPath, [script, secretos, 'sapsend-olp'], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), { Authorization: 'Bearer llave-de-prueba-0123456789' });
  assert.throws(() => execFileSync(process.execPath, [script, secretos, 'otra'], { stdio: 'pipe' }));
  chmodSync(secretos, 0o644);
  assert.throws(() => execFileSync(process.execPath, [script, secretos, 'sapsend-olp'], { stdio: 'pipe' }));
});

test('textoConectores menciona la prohibición de escritura y z_PRUEBAS', () => {
  const t = textoConectores({ servidores: [{ nombre: 'sapbo-gss', herramientas: ['sap_query'], descripcion: '' }], instrucciones: 'extra' });
  assert.match(t, /z_PRUEBAS_/);
  assert.match(t, /extra/);
});
