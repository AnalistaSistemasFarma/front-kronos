import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  carpetaAgenteOpenclaw,
  carpetaEstadoOpenclaw,
  clasificarPerfil,
  crearLectorCredencialOpenclaw,
  elegirPerfilAnthropic,
} from '../src/openclaw/credencial.mjs';
import { crearMedidorCuota } from '../src/cuota.mjs';
import { cargarConfig } from '../src/config.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'oc-cuota-'));
const OAT = 'sk-ant-oat01-' + 'x'.repeat(40);
const API = 'sk-ant-api03-' + 'y'.repeat(40);

test('carpetas: --profile → ~/.openclaw-<perfil>; OPENCLAW_STATE_DIR; por defecto ~/.openclaw', () => {
  assert.equal(carpetaEstadoOpenclaw({ perfil: 'lunaris', env: {}, home: '/h' }), '/h/.openclaw-lunaris');
  assert.equal(carpetaEstadoOpenclaw({ env: { OPENCLAW_STATE_DIR: '/s' }, home: '/h' }), '/s');
  assert.equal(carpetaAgenteOpenclaw({ agente: 'duo', env: {}, home: '/h' }), '/h/.openclaw/agents/duo/agent');
  assert.equal(carpetaAgenteOpenclaw({ perfil: 'lunaris', agente: 'main', env: {}, home: '/h' }), '/h/.openclaw-lunaris/agents/main/agent');
});

test('clasificarPerfil: setup-token y OAuth = oauth-token; llave de API = api-key; sin valor = null', () => {
  assert.equal(clasificarPerfil({ type: 'token', token: OAT }).tipo, 'oauth-token');
  assert.equal(clasificarPerfil({ type: 'oauth', access: OAT }).tipo, 'oauth-token');
  assert.equal(clasificarPerfil({ type: 'api_key', key: API }).tipo, 'api-key');
  assert.equal(clasificarPerfil({ type: 'token', token: API }).tipo, 'api-key');
  assert.equal(clasificarPerfil({ type: 'token' }), null);
});

test('elegirPerfilAnthropic: order, luego lastGood, luego el primero; ignora otros proveedores', () => {
  const almacen = { profiles: {
    'openai:a': { type: 'oauth', provider: 'openai', access: 'eyJ' },
    'anthropic:a': { type: 'token', provider: 'anthropic', token: OAT },
    'anthropic:b': { type: 'api_key', provider: 'anthropic', key: API },
  } };
  assert.equal(elegirPerfilAnthropic(almacen, { order: { anthropic: ['anthropic:b'] } }).perfil, 'anthropic:b');
  assert.equal(elegirPerfilAnthropic(almacen, { lastGood: { anthropic: 'anthropic:b' } }).tipo, 'api-key');
  assert.equal(elegirPerfilAnthropic(almacen, {}).perfil, 'anthropic:a');
  assert.equal(elegirPerfilAnthropic({ profiles: { 'openai:a': almacen.profiles['openai:a'] } }, {}), null);
});

test('lector: lee la base sqlite del agente en solo lectura y nunca expone el valor en describir()', async () => {
  const dir = path.join(tmp(), 'agents', 'duo', 'agent');
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'openclaw-agent.sqlite'));
  db.exec('CREATE TABLE auth_profile_store (store_key TEXT PRIMARY KEY, store_json TEXT, updated_at INTEGER); CREATE TABLE auth_profile_state (state_key TEXT PRIMARY KEY, state_json TEXT, updated_at INTEGER);');
  db.prepare('INSERT INTO auth_profile_store VALUES (?,?,0)').run('primary', JSON.stringify({ profiles: { 'anthropic:manual': { type: 'token', provider: 'anthropic', token: OAT } } }));
  db.prepare('INSERT INTO auth_profile_state VALUES (?,?,0)').run('primary', JSON.stringify({ lastGood: { anthropic: 'anthropic:manual' } }));
  db.close();
  const lector = crearLectorCredencialOpenclaw({ carpetaAgente: dir });
  const c = await lector.leer();
  assert.deepEqual(c, { perfil: 'anthropic:manual', tipo: 'oauth-token', valor: OAT });
  assert.doesNotMatch(lector.describir(), /sk-ant/);
  assert.match(lector.describir(), /token de suscripción \(perfil anthropic:manual\)/);
});

test('lector: almacén compartido de la base de estado (auth.sharedStore = state-db, caso Lunaris)', async () => {
  const estado = tmp();
  const agente = path.join(estado, 'agents', 'main', 'agent');
  mkdirSync(agente, { recursive: true });
  mkdirSync(path.join(estado, 'state'));
  const vacia = new DatabaseSync(path.join(agente, 'openclaw-agent.sqlite'));
  vacia.exec('CREATE TABLE auth_profile_store (store_key TEXT PRIMARY KEY, store_json TEXT, updated_at INTEGER); CREATE TABLE auth_profile_state (state_key TEXT PRIMARY KEY, state_json TEXT, updated_at INTEGER);');
  vacia.close();
  const db = new DatabaseSync(path.join(estado, 'state', 'openclaw.sqlite'));
  db.exec('CREATE TABLE config_machine_state (state_key TEXT PRIMARY KEY, value_json TEXT, updated_at_ms INTEGER)');
  db.prepare('INSERT INTO config_machine_state VALUES (?,?,0)').run('authProfiles.store', JSON.stringify({ profiles: { 'anthropic:manual': { type: 'token', provider: 'anthropic', token: OAT } } }));
  db.close();
  const c = await crearLectorCredencialOpenclaw({ carpetaAgente: agente }).leer();
  assert.equal(c?.perfil, 'anthropic:manual');
  assert.equal(c?.tipo, 'oauth-token');
});

test('lector: auth-profiles.json (versiones viejas); sin nada = null; un fallo devuelve la última buena sin filtrar', async () => {
  const dir = tmp();
  writeFileSync(path.join(dir, 'auth-profiles.json'), JSON.stringify({ profiles: { 'anthropic:k': { type: 'api_key', provider: 'anthropic', key: API } } }));
  assert.equal((await crearLectorCredencialOpenclaw({ carpetaAgente: dir }).leer()).tipo, 'api-key');
  const vacio = crearLectorCredencialOpenclaw({ carpetaAgente: tmp() });
  assert.equal(await vacio.leer(), null);
  assert.match(vacio.describir(), /sin credencial/);

  const d2 = tmp();
  writeFileSync(path.join(d2, 'openclaw-agent.sqlite'), '');
  let n = 0;
  const logs = [];
  const lector = crearLectorCredencialOpenclaw({
    carpetaAgente: d2,
    leerSqlite: async () => {
      n += 1;
      if (n > 1) throw Object.assign(new Error('database is locked ' + OAT), { code: 'ERR_SQLITE_ERROR' });
      return { almacen: { profiles: { 'anthropic:m': { type: 'token', provider: 'anthropic', token: OAT } } }, estado: {} };
    },
    log: (...a) => logs.push(a.join(' ')),
  });
  assert.equal((await lector.leer()).valor, OAT);
  assert.equal((await lector.leer()).valor, OAT, 'base ocupada: se queda con la última buena');
  assert.ok(logs.every((l) => !l.includes('sk-ant')), 'el log no lleva el token');
});

function medidorCon(credencial, extra = {}) {
  const publicados = [];
  const sondas = [];
  const logs = [];
  let t = 1_000_000;
  const m = crearMedidorCuota({
    credencial,
    publicar: async (e) => publicados.push(e),
    sondear: async ({ credencial: c }) => {
      sondas.push(c.tipo);
      return { utilizacion7d: 40, reset7d: null, utilizacion5h: 10, reset5h: null, overage: null, medidoEn: new Date(t).toISOString(), fuente: 'sonda' };
    },
    ahora: () => new Date(t),
    log: (...a) => logs.push(a.join(' ')),
    ...extra,
  });
  return { m, publicados, sondas, logs, avanzar: (ms) => (t += ms) };
}

test('medidor openclaw: credencial como función (se relee en cada sonda) y sonda al cerrar el turno', async () => {
  let lecturas = 0;
  const { m, publicados, sondas, avanzar } = medidorCon(async () => {
    lecturas += 1;
    return { tipo: 'oauth-token', valor: OAT };
  });
  await m.trasTurno();
  assert.equal(publicados.length, 1);
  assert.equal(lecturas, 1);
  await m.trasTurno();
  assert.equal(sondas.length, 1, 'dos turnos seguidos (< 60 s) no repiten la sonda');
  avanzar(61_000);
  await m.trasTurno();
  assert.equal(sondas.length, 2);
  assert.equal(lecturas, 2);
});

test('medidor openclaw: con llave de API o sin credencial no sondea ni publica y lo dice una vez', async () => {
  const api = medidorCon(() => ({ tipo: 'api-key', valor: API }));
  await api.m.trasTurno();
  api.avanzar(400_000);
  await api.m.revisar();
  assert.equal(api.sondas.length, 0);
  assert.equal(api.publicados.length, 0);
  assert.equal(api.logs.filter((l) => /llave de API/.test(l)).length, 1);
  assert.ok(api.logs.every((l) => !l.includes('sk-ant')));
  const nada = medidorCon(async () => null);
  await nada.m.revisar({ forzar: true });
  assert.equal(nada.publicados.length, 0);
  assert.ok(nada.logs.some((l) => /sin datos de cupo para este agente/.test(l)));
});

test('config openclaw: HILOS_OPENCLAW_CUOTA (si por defecto) sin tocar HILOS_CUOTA=no; carpeta del agente opcional', () => {
  const dir = tmp();
  const perfiles = path.join(dir, 'perfiles.json');
  writeFileSync(perfiles, JSON.stringify({ 'sin-conectores': {} }));
  const bin = path.join(dir, 'openclaw');
  writeFileSync(bin, '#!/bin/sh\n');
  const env = (extra = {}) => ({
    HILOS_ENTORNO: 'pruebas', HILOS_SYNERLINK_URL: 'http://192.168.11.230:3030', HILOS_SYNERLINK_KEY: 'k'.repeat(40), HILOS_AGENTE: 'duo',
    HILOS_DIR: path.join(tmp(), 'duo-pruebas'), HILOS_PERFILES: perfiles, HILOS_PERFIL: 'negocio',
    HILOS_RUNNER: 'openclaw', HILOS_OPENCLAW_BIN: bin, HILOS_OPENCLAW_AGENTE: 'duo', HILOS_CUOTA: 'no', ...extra,
  });
  const cfg = cargarConfig(env());
  assert.equal(cfg.cuota.habilitada, true);
  assert.equal(cfg.credencial, null, 'el .env del puente sigue sin credencial');
  assert.equal(cfg.openclaw.dirAgente, null);
  assert.equal(cargarConfig(env({ HILOS_OPENCLAW_CUOTA: 'no' })).cuota.habilitada, false);
  assert.throws(() => cargarConfig(env({ HILOS_OPENCLAW_CUOTA: 'tal vez' })), /HILOS_OPENCLAW_CUOTA/);
  assert.throws(() => cargarConfig(env({ HILOS_CUOTA: 'si' })), /quedan apagados/);
  assert.throws(() => cargarConfig(env({ HILOS_OPENCLAW_DIR_AGENTE: 'rel' })), /absoluta/);
  assert.equal(cargarConfig(env({ HILOS_OPENCLAW_DIR_AGENTE: '/x/agent' })).openclaw.dirAgente, '/x/agent');
});
