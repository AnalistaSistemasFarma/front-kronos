import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extraerMedia, prepararAdjuntos, textoAdjuntosSalida, validarAdjuntos, MAX_BYTES_ADJUNTO } from '../src/adjuntos-salida.mjs';
import { crearClienteSynerLink } from '../src/synerlink.mjs';
import { crearPuente } from '../src/puente.mjs';
import { armarArgumentos } from '../src/claude.mjs';
import { Estado } from '../src/hilos.mjs';
import { validarPerfiles } from '../src/config.mjs';

function hilo() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'adj-'));
  const trabajo = path.join(cwd, 'trabajo');
  mkdirSync(path.join(trabajo, 'salida'), { recursive: true });
  return { cwd, trabajo };
}

test('extraerMedia: saca las líneas MEDIA fuera de bloques de código y deja el resto', () => {
  const t = 'Aquí va el informe.\n\nMEDIA:trabajo/salida/a.csv\n- MEDIA: `trabajo/b.txt`\n```\nMEDIA:trabajo/no.csv\n```\nFin.';
  const r = extraerMedia(t);
  assert.deepEqual(r.rutas, ['trabajo/salida/a.csv', 'trabajo/b.txt']);
  assert.match(r.texto, /Aquí va el informe\.[\s\S]*MEDIA:trabajo\/no\.csv[\s\S]*Fin\./);
  assert.doesNotMatch(r.texto, /a\.csv/);
  assert.deepEqual(extraerMedia('sin marcas').rutas, []);
  assert.equal(extraerMedia('sin marcas').texto, 'sin marcas');
});

test('validarAdjuntos: acepta ./trabajo y rechaza todo lo demás', async () => {
  const { cwd, trabajo } = hilo();
  writeFileSync(path.join(trabajo, 'salida', 'ok.csv'), 'a;b\n1;2\n');
  writeFileSync(path.join(trabajo, 'ok2.md'), '# hola');
  writeFileSync(path.join(cwd, 'fuera.txt'), 'secreto');
  writeFileSync(path.join(trabajo, 'x.sh'), 'echo');
  writeFileSync(path.join(trabajo, 'x.exe'), 'MZ');
  writeFileSync(path.join(trabajo, '.env'), 'K=V');
  writeFileSync(path.join(trabajo, 'vacio.txt'), '');
  writeFileSync(path.join(trabajo, 'propuestas-cronograma.json'), '[]');
  mkdirSync(path.join(cwd, '.puente'));
  writeFileSync(path.join(cwd, '.puente', 'mcp.json'), '{}');
  symlinkSync(path.join(cwd, 'fuera.txt'), path.join(trabajo, 'enlace.txt'));
  symlinkSync(cwd, path.join(trabajo, 'carpeta-enlace'));
  const { archivos, fallidos } = await validarAdjuntos(
    [
      'trabajo/salida/ok.csv', './trabajo/ok2.md', path.join(trabajo, 'salida', 'ok.csv'), // duplicado por ruta absoluta
      'fuera.txt', 'trabajo/../fuera.txt', '.puente/mcp.json', 'trabajo/x.sh', 'trabajo/x.exe', 'trabajo/.env',
      'trabajo/vacio.txt', 'trabajo/enlace.txt', 'trabajo/carpeta-enlace/fuera.txt', 'trabajo/no-existe.csv',
      'file:///etc/passwd', '/etc/hosts', '~/x.txt', 'trabajo/propuestas-cronograma.json',
    ],
    { cwd, trabajo, excluir: ['propuestas-cronograma.json'] }
  );
  assert.deepEqual(archivos.map((a) => a.nombre), ['ok.csv', 'ok2.md']);
  assert.equal(archivos[0].tipo, 'text/csv');
  assert.equal(archivos[0].datos.toString(), 'a;b\n1;2\n');
  const motivos = Object.fromEntries(fallidos.map((f) => [f.nombre, f.motivo]));
  assert.match(motivos['fuera.txt'], /ruta no permitida|fuera de/);
  assert.match(motivos['mcp.json'], /fuera de/);
  assert.match(motivos['x.sh'], /extensión/);
  assert.match(motivos['x.exe'], /extensión/);
  assert.match(motivos['.env'], /oculta/);
  assert.match(motivos['vacio.txt'], /vacío/);
  assert.match(motivos['enlace.txt'], /enlace/);
  assert.match(motivos['no-existe.csv'], /no existe/);
  assert.match(motivos['passwd'], /ruta no permitida/);
  assert.match(motivos['hosts'], /fuera de/);
  assert.match(motivos['propuestas-cronograma.json'], /interno/);
  // Ninguna nota lleva la ruta completa.
  assert.ok(!JSON.stringify(fallidos).includes(cwd));
});

test('validarAdjuntos: tope de 5 archivos y de 25 MB', async () => {
  const { cwd, trabajo } = hilo();
  const rutas = [];
  for (let i = 1; i <= 6; i++) {
    writeFileSync(path.join(trabajo, `f${i}.txt`), `n${i}`);
    rutas.push(`trabajo/f${i}.txt`);
  }
  writeFileSync(path.join(trabajo, 'grande.csv'), Buffer.alloc(MAX_BYTES_ADJUNTO + 1, 65));
  const r = await validarAdjuntos([...rutas, 'trabajo/grande.csv'], { cwd, trabajo });
  assert.equal(r.archivos.length, 5);
  assert.deepEqual(r.fallidos.map((f) => f.nombre), ['f6.txt', 'grande.csv']);
  assert.match(r.fallidos[0].motivo, /máximo 5/);
  // grande.csv cae por el tope de cantidad o de tamaño; por sí solo, por tamaño.
  const g = await validarAdjuntos(['trabajo/grande.csv'], { cwd, trabajo });
  assert.match(g.fallidos[0].motivo, /25 MB/);
});

test('prepararAdjuntos: nota de rechazados y texto mínimo si solo venía la marca', async () => {
  const { cwd, trabajo } = hilo();
  writeFileSync(path.join(trabajo, 'a.csv'), 'x');
  const r = await prepararAdjuntos('MEDIA:trabajo/a.csv\nMEDIA:trabajo/b.sh', { cwd, trabajo });
  assert.equal(r.archivos.length, 1);
  assert.match(r.texto, /No pude adjuntar: b\.sh \(extensión no permitida\)/);
  const s = await prepararAdjuntos('MEDIA:trabajo/a.csv', { cwd, trabajo });
  assert.equal(s.texto, 'Le adjunto el archivo.');
});

test('cliente: responderConArchivos manda multipart con los mismos campos y la llave solo en la cabecera', async () => {
  let pedido = null;
  const cliente = crearClienteSynerLink({
    url: 'https://x', llave: 'LLAVE',
    fetchImpl: async (u, o) => { pedido = { u, o }; return new Response(JSON.stringify({ id: 1 }), { status: 201 }); },
  });
  await cliente.responderConArchivos(12, 'Hola', [{ nombre: 'a.csv', datos: Buffer.from('1;2'), tipo: 'text/csv' }]);
  assert.equal(pedido.u, 'https://x/api/chat/agent/messages');
  assert.equal(pedido.o.headers.Authorization, 'Bearer LLAVE');
  assert.equal(pedido.o.headers['Content-Type'], undefined);
  const f = pedido.o.body;
  assert.equal(f.get('idConversation'), '12');
  assert.equal(f.get('body'), 'Hola');
  assert.equal(f.get('state'), 'idle');
  const file = f.getAll('files')[0];
  assert.equal(file.name, 'a.csv');
  assert.equal(await file.text(), '1;2');
  const malo = crearClienteSynerLink({ url: 'https://x', llave: 'L', fetchImpl: async () => new Response('{"error":"x"}', { status: 502 }) });
  await assert.rejects(() => malo.responderConArchivos(1, 'b', [{ nombre: 'a.txt', datos: Buffer.from('a'), tipo: 'text/plain' }]), /HTTP 502/);
});

test('el encabezado de cada turno explica la convención y no dice que no puede adjuntar', () => {
  const t = textoAdjuntosSalida();
  assert.match(t, /MEDIA:trabajo\/salida\/informe\.csv/);
  assert.match(t, /máximo 5 archivos, 25 MB/);
});

// ---------- Turno completo de un usuario NO operador, proyecto SIN repos ----------

function cfgBase(dir) {
  return {
    hilosDir: dir, agente: 'horus', agenteNombre: 'Orus', maxConcurrencia: 1, timeoutTurnoMs: 5000,
    perfiles: validarPerfiles({}), instruccionesEn: 'system-prompt', claudeBin: 'claude',
    path: '/usr/bin', home: dir, configClaudeDir: path.join(dir, 'claude-config'), credencial: { tipo: 'api-key', valor: 'k' },
    // Operadores con terminal completa: el autor del turno NO está aquí.
    operadoresCodigo: ['nicolas.rivera@gsslatam.com'],
  };
}

function synerlinkFalso({ falla = false } = {}) {
  const llamadas = [];
  return {
    llamadas,
    estado: async () => {},
    contexto: async (id) => ({
      project: {
        idProject: 7, name: 'Comex', company: { companyName: 'ONE LATAM PHARMA' },
        profile: { key: 'sin-conectores', label: 'Sin conectores' }, instructions: '', version: 'v1', files: [],
      },
      conversation: { id, title: 'x' },
    }),
    responder: async (...a) => llamadas.push(['responder', ...a]),
    responderConArchivos: async (...a) => {
      llamadas.push(['responderConArchivos', ...a]);
      if (falla) throw new Error('HTTP 502');
    },
    consumo: async () => {},
    confirmar: async (ids) => llamadas.push(['confirmar', ids]),
    descargar: async () => Buffer.from(''),
  };
}

test('turno de un usuario no operador, sin código ni Bash: crea el archivo en ./trabajo con Write y sale adjunto', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'puente-adj-'));
  const s = synerlinkFalso();
  let opsTurno = null;
  const puente = crearPuente({
    cfg: cfgBase(dir), synerlink: s, estado: new Estado(dir),
    correr: async (opts) => {
      opsTurno = opts;
      // Lo único que el modelo puede hacer sin terminal: Write en ./trabajo.
      mkdirSync(path.join(opts.cwd, 'trabajo', 'salida'), { recursive: true });
      writeFileSync(path.join(opts.cwd, 'trabajo', 'salida', 'resumen.csv'), 'item;valor\nA;1\n');
      return { resultado: { ok: true, texto: 'Le comparto el resumen en `resumen.csv`.\n\nMEDIA:trabajo/salida/resumen.csv\nMEDIA:.puente/mcp.json' }, sessionId: 's', tokens: null };
    },
  });
  puente.recibir([{ id: 1, idConversation: 40, body: 'mándeme el resumen en un archivo', author: { name: 'Usuaria', email: 'usuaria@onelatampharma.com' }, conversation: { kind: 'project' } }]);
  await puente.cola.vacia();

  // Sin terminal y con Write limitado a ./trabajo (lo que ve CUALQUIER usuario).
  assert.equal(opsTurno.codigo ?? null, null);
  const tools = opsTurno.args[opsTurno.args.indexOf('--tools') + 1];
  assert.ok(!tools.split(',').includes('Bash'));
  assert.ok(opsTurno.args.includes('Write(./trabajo/**)'));
  // El encabezado del turno trae la convención.
  assert.match(readFileSync(path.join(opsTurno.cwd, '.puente', 'sistema.md'), 'utf8'), /MEDIA:trabajo\/salida\/informe\.csv/);

  const env = s.llamadas.find((l) => l[0] === 'responderConArchivos');
  assert.ok(env, 'publicó con adjuntos');
  assert.equal(env[1], 40);
  assert.match(env[2], /Le comparto el resumen/);
  assert.doesNotMatch(env[2], /MEDIA:/);
  assert.match(env[2], /No pude adjuntar: mcp\.json \(fuera de \.\/trabajo\)/);
  assert.deepEqual(env[3].map((a) => a.nombre), ['resumen.csv']);
  assert.equal(env[3][0].datos.toString(), 'item;valor\nA;1\n');
  assert.ok(!s.llamadas.some((l) => l[0] === 'responder'), 'no publicó dos veces');
  assert.deepEqual(s.llamadas.find((l) => l[0] === 'confirmar')[1], [1]);
});

test('si la subida falla, la respuesta sale igual (sin archivos) y lo dice', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'puente-adj-'));
  const s = synerlinkFalso({ falla: true });
  const puente = crearPuente({
    cfg: cfgBase(dir), synerlink: s, estado: new Estado(dir),
    correr: async (opts) => {
      writeFileSync(path.join(opts.cwd, 'trabajo', 'a.txt'), 'hola');
      return { resultado: { ok: true, texto: 'Listo.\nMEDIA:trabajo/a.txt' }, sessionId: 's', tokens: null };
    },
  });
  puente.recibir([{ id: 2, idConversation: 41, body: 'x', author: { name: 'U' }, conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  const r = s.llamadas.find((l) => l[0] === 'responder');
  assert.ok(r);
  assert.match(r[2], /^Listo\.[\s\S]*No pude subir el archivo \(a\.txt\)/);
});

test('turno con error del modelo: no adjunta nada aunque haya marcas', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'puente-adj-'));
  const s = synerlinkFalso();
  const puente = crearPuente({
    cfg: cfgBase(dir), synerlink: s, estado: new Estado(dir),
    correr: async (opts) => {
      writeFileSync(path.join(opts.cwd, 'trabajo', 'a.txt'), 'hola');
      return { resultado: { ok: false, texto: 'MEDIA:trabajo/a.txt', subtipo: 'error_during_execution' }, sessionId: 's', tokens: null };
    },
  });
  puente.recibir([{ id: 3, idConversation: 42, body: 'x', conversation: { kind: 'project' } }]);
  await puente.cola.vacia();
  assert.ok(!s.llamadas.some((l) => l[0] === 'responderConArchivos'));
});

test('armarArgumentos sin código: Write(./trabajo/**) siempre presente (base de los adjuntos)', () => {
  const args = armarArgumentos({ perfil: { herramientas: [], web: false }, sesion: { id: '00000000-0000-4000-8000-000000000000', nueva: true }, rutaMcp: '/m', rutaSistema: '/s', dirArchivos: '/a' });
  assert.ok(args.includes('Write(./trabajo/**)'));
  assert.ok(args[args.indexOf('--tools') + 1].split(',').includes('Write'));
});
