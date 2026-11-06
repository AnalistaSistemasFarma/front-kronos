import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crearArchivador, textoArchivarProyecto } from '../src/archivar-proyecto.mjs';
import { crearClienteSynerLink, ErrorSynerLink } from '../src/synerlink.mjs';
import { crearPuente } from '../src/puente.mjs';
import { Estado } from '../src/hilos.mjs';
import { cargarConfig, validarPerfiles } from '../src/config.mjs';

/*
 * Archivos del proyecto (2026-10-23, requisito de Nicolás Rivera): lo que el hilo adjunta
 * (MEDIA:/PDF:) se sube ADEMÁS a la pestaña Archivos del proyecto. Para TODOS los usuarios
 * (incluido el no operador, sin terminal) y todos los proyectos.
 */
const archivo = (nombre = 'informe.pdf') => ({ nombre, datos: Buffer.from('%PDF-1.4'), tipo: 'application/pdf', bytes: 8 });

// ---------- Cliente ----------

test('cliente: archivarEnProyecto manda multipart (idConversation + files) a la ruta nueva, con la llave solo en la cabecera', async () => {
  let pedido = null;
  const cliente = crearClienteSynerLink({
    url: 'https://x', llave: 'LLAVE',
    fetchImpl: async (u, o) => { pedido = { u, o }; return new Response(JSON.stringify({ archived: [{ id: 5, fileName: 'a.csv', originalName: 'a.csv', renamed: false }], idProject: 7 }), { status: 201 }); },
  });
  const r = await cliente.archivarEnProyecto(27, [{ nombre: 'a.csv', datos: Buffer.from('1;2'), tipo: 'text/csv' }]);
  assert.equal(pedido.u, 'https://x/api/chat/agent/projects/files');
  assert.equal(pedido.o.method, 'POST');
  assert.equal(pedido.o.headers.Authorization, 'Bearer LLAVE');
  assert.equal(pedido.o.headers['Content-Type'], undefined);
  assert.equal(pedido.o.body.get('idConversation'), '27');
  const f = pedido.o.body.getAll('files')[0];
  assert.equal(f.name, 'a.csv');
  assert.equal(await f.text(), '1;2');
  assert.equal(r.archived[0].id, 5);
});

test('cliente: 404 sin cuerpo de la API = ruta ausente; 404/409 con error de la API traen el detalle', async () => {
  const con = (status, cuerpo) => crearClienteSynerLink({ url: 'https://x', llave: 'L', fetchImpl: async () => new Response(cuerpo, { status }) });
  await assert.rejects(() => con(404, '<html>404</html>').archivarEnProyecto(1, [archivo()]), (e) => e.status === 404 && e.rutaAusente === true && e.detalle === null);
  await assert.rejects(() => con(404, '{"error":"Conversación no encontrada."}').archivarEnProyecto(1, [archivo()]), (e) => e.status === 404 && e.rutaAusente === false && e.detalle === 'Conversación no encontrada.');
  await assert.rejects(() => con(409, '{"error":"El proyecto llegó al máximo de 20 archivos."}').archivarEnProyecto(1, [archivo()]), (e) => e.status === 409 && /máximo de 20/.test(e.detalle));
});

// ---------- Archivador ----------

test('archivador: éxito → una línea; un nombre repetido dice cómo quedó', async () => {
  const llamadas = [];
  const a = crearArchivador({
    synerlink: { archivarEnProyecto: async (...x) => { llamadas.push(x); return { archived: [{ id: 1, fileName: 'informe (2).pdf', originalName: 'informe.pdf', renamed: true }] }; } },
  });
  const nota = await a.archivar(27, [archivo()]);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0][0], 27);
  assert.match(nota, /^📁 Quedó archivado en los Archivos del proyecto \(informe\.pdf como «informe \(2\)\.pdf»/);
  assert.equal(nota.split('\n').length, 1);
});

test('archivador: sin archivos o sin la función en el cliente, no hace nada', async () => {
  assert.equal(await crearArchivador({ synerlink: { archivarEnProyecto: async () => assert.fail('no debía llamar') } }).archivar(1, []), '');
  assert.equal(await crearArchivador({ synerlink: {} }).archivar(1, [archivo()]), '');
});

test('archivador: ruta ausente (404) → reintento tras una pausa corta; si sigue, avisa y no insiste hasta la pausa larga', async () => {
  let t = 1_000;
  const pausas = [];
  let intentos = 0;
  const logs = [];
  const a = crearArchivador({
    synerlink: { archivarEnProyecto: async () => { intentos++; throw new ErrorSynerLink('404', 404, { rutaAusente: true }); } },
    ahora: () => t,
    dormir: async (ms) => { pausas.push(ms); },
    pausaReintentoMs: 3_000,
    pausa404Ms: 300_000,
    log: (m) => logs.push(m),
  });
  const n1 = await a.archivar(27, [archivo()]);
  assert.equal(intentos, 2, 'un reintento');
  assert.deepEqual(pausas, [3_000]);
  assert.match(n1, /^⚠️ El archivo \(informe\.pdf\) salió con la respuesta, pero no quedó archivado en los Archivos del proyecto: esa función aún no está disponible/);
  // Dentro de la pausa larga: ni lo intenta.
  t += 60_000;
  const n2 = await a.archivar(27, [archivo('b.csv')]);
  assert.equal(intentos, 2);
  assert.match(n2, /b\.csv/);
  // Pasada la pausa, vuelve a intentar y, si ya existe, archiva.
  t += 300_000;
  let ok = false;
  const b = crearArchivador({ synerlink: { archivarEnProyecto: async () => { if (!ok) { ok = true; throw new ErrorSynerLink('404', 404, { rutaAusente: true }); } return { archived: [] }; } }, dormir: async () => {} });
  assert.match(await b.archivar(1, [archivo()]), /^📁/);
  assert.equal(logs.filter((m) => /no trae \/api\/chat\/agent\/projects\/files/.test(m)).length, 1, 'un solo aviso en el log');
});

test('archivador: proyecto lleno (409) → la línea trae el motivo de la API; un 502 → motivo genérico; nunca lanza', async () => {
  const lleno = crearArchivador({ synerlink: { archivarEnProyecto: async () => { throw new ErrorSynerLink('409', 409, { detalle: 'El proyecto llegó al máximo de 20 archivos; quite alguno en la pestaña Archivos.' }); } } });
  assert.match(await lleno.archivar(1, [archivo(), archivo('b.csv')]), /^⚠️ Los archivos \(informe\.pdf, b\.csv\) salieron con la respuesta, pero no quedaron archivados[^\n]*máximo de 20 archivos/);
  const caido = crearArchivador({ synerlink: { archivarEnProyecto: async () => { throw new ErrorSynerLink('502', 502, { detalle: 'No se pudieron guardar los archivos.' }); } } });
  assert.match(await caido.archivar(1, [archivo()]), /puede cargarlos a mano en la pestaña Archivos/);
  // 404 de la API (conversación) no es ruta ausente: no reintenta.
  let n = 0;
  const conv = crearArchivador({ synerlink: { archivarEnProyecto: async () => { n++; throw new ErrorSynerLink('404', 404, { detalle: 'Conversación no encontrada.' }); } }, dormir: async () => assert.fail('no debía esperar') });
  assert.match(await conv.archivar(1, [archivo()]), /^⚠️/);
  assert.equal(n, 1);
});

test('encabezado: dice que lo adjunto queda archivado, sin pisar, y que la carpeta de archivos es solo lectura', () => {
  const t = textoArchivarProyecto();
  assert.match(t, /queda ADEMÁS archivado en la pestaña Archivos del proyecto/);
  assert.match(t, /nombre \(2\)/);
  assert.match(t, /espejo de solo lectura/);
});

test('config: HILOS_ARCHIVAR_EN_PROYECTO encendido por defecto; «no» lo apaga; otro valor falla', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cfg-'));
  const perfiles = path.join(dir, 'perfiles.json');
  writeFileSync(perfiles, JSON.stringify({ farmalogica: { mcpServers: { s: { type: 'http', url: 'http://x/mcp' } }, herramientas: ['mcp__s__sap_query'] } }));
  const base = {
    HILOS_ENTORNO: 'pruebas', HILOS_SYNERLINK_URL: 'http://pruebas.local:3070/', HILOS_SYNERLINK_KEY: 'k'.repeat(40),
    HILOS_AGENTE: 'Play', HILOS_DIR: path.join(dir, 'puente'), HILOS_PERFILES: perfiles, HILOS_ANTHROPIC_API_KEY: 'sk-test',
  };
  assert.equal(cargarConfig(base).archivarEnProyecto, true);
  assert.equal(cargarConfig({ ...base, HILOS_ARCHIVAR_EN_PROYECTO: 'no' }).archivarEnProyecto, false);
  assert.throws(() => cargarConfig({ ...base, HILOS_ARCHIVAR_EN_PROYECTO: 'tal vez' }), /HILOS_ARCHIVAR_EN_PROYECTO/);
});

// ---------- Turno completo: usuario NO operador, proyecto sin repos ----------

function cfgBase(dir, extra = {}) {
  return {
    hilosDir: dir, agente: 'horus', agenteNombre: 'Orus', maxConcurrencia: 1, timeoutTurnoMs: 5000,
    perfiles: validarPerfiles({}), instruccionesEn: 'system-prompt', claudeBin: 'claude',
    path: '/usr/bin', home: dir, configClaudeDir: path.join(dir, 'claude-config'), credencial: { tipo: 'api-key', valor: 'k' },
    operadoresCodigo: ['nicolas.rivera@gsslatam.com'],
    ...extra,
  };
}

function synerlinkFalso({ archivar = async () => ({ archived: [{ id: 9, fileName: 'resumen.csv', originalName: 'resumen.csv', renamed: false }] }) } = {}) {
  const llamadas = [];
  return {
    llamadas,
    estado: async (...a) => llamadas.push(['estado', ...a]),
    contexto: async (id) => ({
      project: { idProject: 7, name: 'Comex', company: { companyName: 'ONE LATAM PHARMA' }, profile: { key: 'sin-conectores', label: 'Sin conectores' }, instructions: '', version: 'v1', files: [] },
      conversation: { id, title: 'x' },
    }),
    responder: async (...a) => llamadas.push(['responder', ...a]),
    responderConArchivos: async (...a) => llamadas.push(['responderConArchivos', ...a]),
    archivarEnProyecto: async (...a) => { llamadas.push(['archivarEnProyecto', ...a]); return archivar(...a); },
    consumo: async () => {},
    confirmar: async (ids) => llamadas.push(['confirmar', ids]),
    descargar: async () => Buffer.from(''),
  };
}

function turnoConArchivo(dir, s, cfgExtra) {
  let opsTurno = null;
  const puente = crearPuente({
    cfg: cfgBase(dir, cfgExtra), synerlink: s, estado: new Estado(dir),
    correr: async (opts) => {
      opsTurno = opts;
      writeFileSync(path.join(opts.cwd, 'trabajo', 'resumen.csv'), 'item;valor\nA;1\n');
      return { resultado: { ok: true, texto: 'Le comparto el resumen.\n\nMEDIA:trabajo/resumen.csv' }, sessionId: 's', tokens: null };
    },
  });
  puente.recibir([{ id: 1, idConversation: 40, body: 'mándeme el resumen', author: { name: 'Usuaria', email: 'usuaria@onelatampharma.com' }, conversation: { kind: 'project' } }]);
  return { puente, ops: () => opsTurno };
}

test('turno de un usuario no operador: el adjunto sale con la respuesta Y queda archivado en el proyecto; el encabezado lo avisa', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'puente-arch-'));
  const s = synerlinkFalso();
  const { puente, ops } = turnoConArchivo(dir, s);
  await puente.cola.vacia();

  assert.match(readFileSync(path.join(ops().cwd, '.puente', 'sistema.md'), 'utf8'), /queda ADEMÁS archivado en la pestaña Archivos del proyecto/);
  const arch = s.llamadas.find((l) => l[0] === 'archivarEnProyecto');
  assert.ok(arch, 'archivó');
  assert.equal(arch[1], 40);
  assert.deepEqual(arch[2].map((a) => a.nombre), ['resumen.csv']);
  const env = s.llamadas.find((l) => l[0] === 'responderConArchivos');
  assert.ok(env, 'publicó con el adjunto');
  assert.deepEqual(env[3].map((a) => a.nombre), ['resumen.csv']);
  assert.match(env[2], /Le comparto el resumen\.\n\n📁 Quedó archivado en los Archivos del proyecto\.$/);
  // Archiva ANTES de publicar (la nota va en la misma respuesta).
  assert.ok(s.llamadas.indexOf(arch) < s.llamadas.indexOf(env));
});

test('si falla el archivo del proyecto, la respuesta sale igual con el adjunto y lo dice en una línea', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'puente-arch-'));
  const s = synerlinkFalso({ archivar: async () => { throw new ErrorSynerLink('502', 502, {}); } });
  const { puente } = turnoConArchivo(dir, s);
  await puente.cola.vacia();
  const env = s.llamadas.find((l) => l[0] === 'responderConArchivos');
  assert.ok(env);
  assert.deepEqual(env[3].map((a) => a.nombre), ['resumen.csv']);
  const ultima = env[2].split('\n').at(-1);
  assert.match(ultima, /^⚠️ El archivo \(resumen\.csv\) salió con la respuesta, pero no quedó archivado/);
});

test('HILOS_ARCHIVAR_EN_PROYECTO=no: ni archiva ni lo dice el encabezado', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'puente-arch-'));
  const s = synerlinkFalso();
  const { puente, ops } = turnoConArchivo(dir, s, { archivarEnProyecto: false });
  await puente.cola.vacia();
  assert.ok(!s.llamadas.some((l) => l[0] === 'archivarEnProyecto'));
  assert.doesNotMatch(readFileSync(path.join(ops().cwd, '.puente', 'sistema.md'), 'utf8'), /archivado en la pestaña Archivos/);
  assert.ok(s.llamadas.some((l) => l[0] === 'responderConArchivos'));
});

test('turno sin adjuntos: no llama a la ruta de archivos', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'puente-arch-'));
  const s = synerlinkFalso();
  const puente = crearPuente({
    cfg: cfgBase(dir), synerlink: s, estado: new Estado(dir),
    correr: async () => ({ resultado: { ok: true, texto: 'Hola.' }, sessionId: 's', tokens: null }),
  });
  puente.recibir([{ id: 2, idConversation: 41, body: 'x', author: { name: 'U' }, conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  assert.ok(!s.llamadas.some((l) => l[0] === 'archivarEnProyecto'));
});
