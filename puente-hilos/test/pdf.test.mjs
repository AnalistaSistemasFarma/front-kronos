import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { argumentosChrome, convertirHtmlAPdf, convertirMarcasPdf, extraerMarcasPdf, perfilSandbox, recursosDePlugins, resolverChrome, textoPdf, MAX_CONVERSIONES } from '../src/pdf.mjs';
import { cargarConfig, validarPerfiles } from '../src/config.mjs';
import { crearPuente } from '../src/puente.mjs';
import { Estado } from '../src/hilos.mjs';

const tmp = () => realpathSync(mkdtempSync(path.join(tmpdir(), 'puente-pdf-test-')));
const PDF_FALSO = Buffer.from('%PDF-1.7\n%falso\n');
const convertirFalso = (llamadas = []) => async (o) => {
  llamadas.push(o);
  return { ok: true, datos: PDF_FALSO, ms: 5 };
};

function conversacion() {
  const cwd = tmp();
  const trabajo = path.join(cwd, 'trabajo');
  mkdirSync(path.join(trabajo, 'salida'), { recursive: true });
  return { cwd, trabajo };
}

// ---------- Marcas ----------

test('extraerMarcasPdf: PDF: con cualquier ruta y MEDIA: solo con .html/.htm, nunca dentro de bloques de código', () => {
  const t = ['Listo.', 'PDF:trabajo/salida/a.html', '- MEDIA: `trabajo/b.htm`', 'MEDIA:trabajo/c.csv', '```', 'PDF:trabajo/d.html', '```', 'PDF:trabajo/e.docx'].join('\n');
  const { marcas } = extraerMarcasPdf(t);
  assert.deepEqual(marcas.map((m) => [m.tipo, m.ruta]), [['PDF', 'trabajo/salida/a.html'], ['MEDIA', 'trabajo/b.htm'], ['PDF', 'trabajo/e.docx']]);
});

test('convertirMarcasPdf: cambia la marca por MEDIA:…pdf, deja el PDF junto al HTML y pasa las carpetas de lectura a Chrome', async () => {
  const { cwd, trabajo } = conversacion();
  writeFileSync(path.join(trabajo, 'salida', 'informe.html'), '<h1>x</h1>');
  const llamadas = [];
  const r = await convertirMarcasPdf('Le comparto el informe.\n\nPDF:trabajo/salida/informe.html\nMEDIA:trabajo/salida/informe.html', {
    cwd, trabajo, lecturas: [trabajo, '/recursos'], chrome: '/chrome', convertir: convertirFalso(llamadas),
  });
  assert.equal(r.texto, 'Le comparto el informe.\n\nMEDIA:trabajo/salida/informe.pdf\nMEDIA:trabajo/salida/informe.pdf');
  assert.equal(llamadas.length, 1, 'el mismo HTML se convierte una sola vez');
  assert.deepEqual(llamadas[0].lecturas, [trabajo, '/recursos']);
  assert.equal(llamadas[0].html, path.join(trabajo, 'salida', 'informe.html'));
  assert.deepEqual(readFileSync(path.join(trabajo, 'salida', 'informe.pdf')), PDF_FALSO);
  assert.deepEqual(r.convertidos.map((c) => c.pdf), ['informe.pdf']);
});

test('convertirMarcasPdf rechaza fuera de ./trabajo, `..`, URL, ocultos, enlaces simbólicos, no-HTML y lo que no existe', async () => {
  const { cwd, trabajo } = conversacion();
  mkdirSync(path.join(cwd, '.puente'));
  writeFileSync(path.join(cwd, '.puente', 'x.html'), 'x');
  writeFileSync(path.join(cwd, 'fuera.html'), 'x');
  writeFileSync(path.join(trabajo, '.oculto.html'), 'x');
  writeFileSync(path.join(trabajo, 'a.docx'), 'x');
  const afuera = tmp();
  writeFileSync(path.join(afuera, 'secreto.html'), 'x');
  symlinkSync(path.join(afuera, 'secreto.html'), path.join(trabajo, 'enlace.html'));
  symlinkSync(afuera, path.join(trabajo, 'carpeta'));
  const llamadas = [];
  const marcas = ['.puente/x.html', 'fuera.html', 'trabajo/../fuera.html', 'file:///etc/hosts.html', 'trabajo/.oculto.html', 'trabajo/enlace.html', 'trabajo/carpeta/secreto.html', 'trabajo/a.docx', 'trabajo/no-existe.html', `${afuera}/secreto.html`];
  const r = await convertirMarcasPdf(`Hola\n${marcas.map((m) => `PDF:${m}`).join('\n')}`, { cwd, trabajo, chrome: '/c', convertir: convertirFalso(llamadas) });
  assert.equal(llamadas.length, 0, 'nada llegó a Chrome');
  assert.doesNotMatch(r.texto, /^(PDF|MEDIA):/m);
  assert.match(r.texto, /^Hola\n\n⚠️ No pude convertir a PDF: /);
  const motivo = (n) => r.fallidos.find((f) => f.nombre === n)?.motivo;
  assert.equal(motivo('x.html'), 'fuera de ./trabajo');
  assert.equal(motivo('fuera.html'), 'fuera de ./trabajo');
  assert.equal(motivo('hosts.html'), 'ruta no permitida');
  assert.equal(motivo('.oculto.html'), 'archivo o carpeta oculta');
  assert.equal(motivo('enlace.html'), 'enlace simbólico no permitido');
  assert.equal(motivo('a.docx'), 'solo se convierte HTML (.html o .htm)');
  assert.equal(motivo('no-existe.html'), 'no existe');
  assert.ok(!existsSync(path.join(afuera, 'secreto.pdf')));
});

test('convertirMarcasPdf: tope de conversiones, credencial del turno y falla de Chrome se dicen en el hilo', async () => {
  const { cwd, trabajo } = conversacion();
  const marcas = [];
  for (let i = 1; i <= MAX_CONVERSIONES + 1; i++) {
    writeFileSync(path.join(trabajo, `d${i}.html`), `<p>${i}</p>`);
    marcas.push(`PDF:trabajo/d${i}.html`);
  }
  const r = await convertirMarcasPdf(marcas.join('\n'), { cwd, trabajo, chrome: '/c', convertir: convertirFalso() });
  assert.equal(r.convertidos.length, MAX_CONVERSIONES);
  assert.match(r.texto, /d6\.html \(máximo 5 por respuesta\)/);

  writeFileSync(path.join(trabajo, 'tok.html'), '<p>ghp_secreto123</p>');
  const r2 = await convertirMarcasPdf('PDF:trabajo/tok.html', { cwd, trabajo, chrome: '/c', token: 'ghp_secreto123', convertir: convertirFalso() });
  assert.match(r2.texto, /tok\.html \(contiene una credencial\)/);
  assert.ok(!existsSync(path.join(trabajo, 'tok.pdf')));

  const r3 = await convertirMarcasPdf('Listo.\nPDF:trabajo/d1.html', { cwd, trabajo, chrome: '/c', convertir: async () => ({ ok: false, motivo: 'superó 60 s' }) });
  assert.equal(r3.texto, 'Listo.\n\n⚠️ No pude convertir a PDF: d1.html (superó 60 s).');
});

test('convertirMarcasPdf no sigue un enlace simbólico puesto en el nombre del PDF: lo reemplaza', async () => {
  const { cwd, trabajo } = conversacion();
  const afuera = tmp();
  writeFileSync(path.join(afuera, 'victima.txt'), 'original');
  writeFileSync(path.join(trabajo, 'x.html'), '<p>x</p>');
  symlinkSync(path.join(afuera, 'victima.txt'), path.join(trabajo, 'x.pdf'));
  const r = await convertirMarcasPdf('PDF:trabajo/x.html', { cwd, trabajo, chrome: '/c', convertir: convertirFalso() });
  assert.equal(r.texto, 'MEDIA:trabajo/x.pdf');
  assert.equal(readFileSync(path.join(afuera, 'victima.txt'), 'utf8'), 'original');
  assert.deepEqual(readFileSync(path.join(trabajo, 'x.pdf')), PDF_FALSO);
});

// ---------- Sandbox y Chrome ----------

test('perfil de sandbox: niega la red y la lectura de /Users, tmp y /Volumes salvo los parámetros; escribe solo en TMP', () => {
  const p = perfilSandbox(2);
  assert.match(p, /\(deny network\*\)/);
  assert.doesNotMatch(p, /allow network/);
  assert.match(p, /\(deny file-read-data \(subpath "\/Users"\) \(subpath "\/private\/tmp"\) \(subpath "\/private\/var\/folders"\) \(subpath "\/Volumes"\)/);
  assert.match(p, /\(allow file-read-data \(subpath \(param "CHROME"\)\) \(subpath \(param "TMP"\)\) \(subpath \(param "LEER0"\)\) \(subpath \(param "LEER1"\)\)\)/);
  assert.match(p, /\(deny file-write\* \(subpath "\/"\)\)\n\(allow file-write\* \(subpath \(param "TMP"\)\)/);
});

test('argumentos de Chrome: sin ventana, proxy muerto sin bypass de loopback, sin resolvedor y sin acceso libre a file://', () => {
  const a = argumentosChrome({ tmp: '/t', salida: '/t/s.pdf', html: '/c/trabajo/a b.html' });
  for (const f of ['--headless', '--disable-gpu', '--disable-background-networking', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND', '--print-to-pdf=/t/s.pdf', '--user-data-dir=/t/perfil']) assert.ok(a.includes(f), f);
  assert.ok(!a.some((x) => /allow-file-access|remote-debugging|disable-web-security/.test(x)));
  assert.equal(a.at(-1), 'file:///c/trabajo/a%20b.html');
});

test('resolverChrome: el chrome-headless-shell más nuevo de Playwright, o el explícito si existe', () => {
  const home = tmp();
  for (const v of ['1217', '1243', '999']) {
    const d = path.join(home, 'Library', 'Caches', 'ms-playwright', `chromium_headless_shell-${v}`, 'chrome-headless-shell-mac-arm64');
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 'chrome-headless-shell'), '');
    chmodSync(path.join(d, 'chrome-headless-shell'), 0o755);
  }
  assert.match(resolverChrome({ home }), /chromium_headless_shell-1243\//);
  assert.equal(resolverChrome({ home: tmp() }), null);
  assert.equal(resolverChrome({ explicito: '/no/existe/chrome', home }), null);
});

test('recursosDePlugins: solo la carpeta recursos/ de los plugins que la tienen', () => {
  const a = tmp();
  const b = tmp();
  mkdirSync(path.join(b, 'recursos'));
  assert.deepEqual(recursosDePlugins([a, b]), [path.join(b, 'recursos')]);
});

test('textoPdf: convención PDF:, sin internet, recursos de solo lectura y la skill gss-design', () => {
  const t = textoPdf({ disponible: true, recursos: ['/h/.puente-hilos/plugins/gss-design/recursos'] });
  assert.match(t, /PDF:trabajo\/salida\/informe\.html/);
  assert.match(t, /aunque no tenga terminal/);
  assert.match(t, /NO hay internet/);
  assert.match(t, /RECURSOS DE SOLO LECTURA: `\/h\/\.puente-hilos\/plugins\/gss-design\/recursos`/);
  assert.match(t, /gss-design:gss-design/);
  assert.match(textoPdf({ disponible: false }), /no puede convertir/);
});

test('config: HILOS_PDF (si|no), HILOS_PDF_CHROME absoluto y HILOS_PDF_TIMEOUT_MS acotado', () => {
  const dir = tmp();
  const perfiles = path.join(dir, 'perfiles.json');
  writeFileSync(perfiles, '{}');
  const env = (extra) => ({ HILOS_ENTORNO: 'pruebas', HILOS_SYNERLINK_URL: 'http://pruebas.local:3070/', HILOS_SYNERLINK_KEY: 'k'.repeat(40), HILOS_AGENTE: 'Play', HILOS_DIR: path.join(dir, 'p'), HILOS_PERFILES: perfiles, HILOS_ANTHROPIC_API_KEY: 'sk-test', ...extra });
  assert.deepEqual(cargarConfig(env({})).pdf, { habilitado: true, chrome: null, timeoutMs: 60000 });
  assert.equal(cargarConfig(env({ HILOS_PDF: 'no' })).pdf.habilitado, false);
  assert.throws(() => cargarConfig(env({ HILOS_PDF: 'tal vez' })), /HILOS_PDF/);
  assert.throws(() => cargarConfig(env({ HILOS_PDF_CHROME: 'chrome' })), /absoluta/);
  assert.throws(() => cargarConfig(env({ HILOS_PDF_TIMEOUT_MS: '999999' })), /HILOS_PDF_TIMEOUT_MS/);
});

// ---------- Turno completo: usuario NO operador, sin Bash ----------

test('turno sin terminal: la sesión deja un HTML con Write, pide PDF: y el hilo recibe el PDF (el HTML no sale)', async () => {
  const dir = tmp();
  const plugin = path.join(dir, 'plugins', 'gss-design');
  mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
  mkdirSync(path.join(plugin, 'recursos'));
  const llamadas = [];
  const conv = [];
  const s = {
    estado: async () => {},
    contexto: async (id) => ({ project: { idProject: 7, name: 'Comex', company: { companyName: 'ONE LATAM PHARMA' }, profile: { key: 'sin-conectores', label: 'Sin conectores' }, instructions: '', version: 'v1', files: [] }, conversation: { id, title: 'x' } }),
    responder: async (...a) => llamadas.push(['responder', ...a]),
    responderConArchivos: async (...a) => llamadas.push(['responderConArchivos', ...a]),
    consumo: async () => {},
    confirmar: async () => {},
    descargar: async () => Buffer.from(''),
  };
  let opts = null;
  const cfg = {
    hilosDir: dir, agente: 'horus', agenteNombre: 'Orus', maxConcurrencia: 1, timeoutTurnoMs: 5000,
    perfiles: validarPerfiles({}), instruccionesEn: 'system-prompt', claudeBin: 'claude',
    path: '/usr/bin', home: dir, configClaudeDir: path.join(dir, 'claude-config'), credencial: { tipo: 'api-key', valor: 'k' },
    operadoresCodigo: ['nicolas.rivera@gsslatam.com'], pluginDirs: [plugin],
    pdf: { habilitado: true, chrome: process.execPath, timeoutMs: 10000 },
  };
  const puente = crearPuente({
    cfg, synerlink: s, estado: new Estado(dir),
    convertirPdf: convertirFalso(conv),
    correr: async (o) => {
      opts = o;
      mkdirSync(path.join(o.cwd, 'trabajo', 'salida'), { recursive: true });
      writeFileSync(path.join(o.cwd, 'trabajo', 'salida', 'informe.html'), '<link rel="stylesheet" href="/x/colors_and_type.css"><h1>Informe</h1>');
      return { resultado: { ok: true, texto: 'Le comparto el informe en PDF.\n\nPDF:trabajo/salida/informe.html' }, sessionId: 's', tokens: null };
    },
  });
  puente.recibir([{ id: 1, idConversation: 50, body: 'hágame el informe en PDF', author: { name: 'Usuaria', email: 'usuaria@onelatampharma.com' }, conversation: { kind: 'project' } }]);
  await puente.cola.vacia();

  const tools = opts.args[opts.args.indexOf('--tools') + 1].split(',');
  assert.ok(!tools.includes('Bash'), 'sin terminal');
  assert.ok(tools.includes('Skill'));
  assert.equal(opts.args[opts.args.indexOf('--plugin-dir') + 1], plugin);
  const iRec = opts.args.indexOf(path.join(plugin, 'recursos'));
  assert.equal(opts.args[iRec - 1], '--add-dir', 'recursos montados en solo lectura');
  assert.ok(!opts.args.some((x) => /^(Edit|Write)\(.*recursos/.test(x)), 'recursos sin escritura');
  const sistema = readFileSync(path.join(opts.cwd, '.puente', 'sistema.md'), 'utf8');
  assert.match(sistema, /PDF:trabajo\/salida\/informe\.html/);
  assert.match(sistema, /gss-design:gss-design/);

  assert.equal(conv.length, 1);
  assert.deepEqual(conv[0].lecturas.slice(0, 1), [path.join(opts.cwd, 'trabajo')]);
  assert.ok(conv[0].lecturas.includes(path.join(plugin, 'recursos')));
  assert.ok(!conv[0].lecturas.some((d) => d.endsWith('.puente')), 'Chrome no lee .puente');
  const env = llamadas.find((l) => l[0] === 'responderConArchivos');
  assert.ok(env, 'publicó con adjunto');
  assert.match(env[2], /Le comparto el informe en PDF\./);
  assert.doesNotMatch(env[2], /PDF:|MEDIA:/);
  assert.deepEqual(env[3].map((a) => [a.nombre, a.tipo]), [['informe.pdf', 'application/pdf']]);
});

// ---------- Chrome REAL (se salta si no hay chrome-headless-shell) ----------

const chromeReal = resolverChrome({ home: process.env.HOME });
test('Chrome real en el sandbox: genera el PDF, no lee archivos fuera de lo permitido y no sale a la red (ni a localhost)', { skip: !chromeReal || !existsSync('/usr/bin/sandbox-exec') ? 'sin chrome-headless-shell' : false, timeout: 90000 }, async () => {
  const pedidos = [];
  const servidor = createServer((req, res) => {
    pedidos.push(req.url);
    res.end('FILTRADO');
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const puerto = servidor.address().port;
  try {
    const { cwd, trabajo } = conversacion();
    const afuera = tmp();
    writeFileSync(path.join(afuera, 'secreto.txt'), 'SECRETO-NO-DEBE-SALIR');
    const rec = tmp();
    writeFileSync(path.join(rec, 'estilo.css'), 'h1 { color: rgb(26, 60, 110); }');
    writeFileSync(path.join(trabajo, 'nota.txt'), 'NOTA-PERMITIDA');
    writeFileSync(
      path.join(trabajo, 'doc.html'),
      `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${rec}/estilo.css"><h1>Prueba PDF</h1>
<iframe src="file://${afuera}/secreto.txt"></iframe><iframe src="nota.txt"></iframe>
<img src="http://127.0.0.1:${puerto}/img.png"><iframe src="http://localhost:${puerto}/f"></iframe>
<script>fetch('http://127.0.0.1:${puerto}/js').catch(()=>{}); document.write('<p>JS-OK</p>')</script>`
    );
    const r = await convertirHtmlAPdf({ html: path.join(trabajo, 'doc.html'), chrome: chromeReal, lecturas: [trabajo, rec] });
    assert.equal(r.ok, true, r.motivo);
    assert.equal(r.datos.subarray(0, 5).toString(), '%PDF-');
    // El texto del PDF va comprimido: se lee con pdftotext si está (Homebrew poppler).
    const pdftotext = ['/opt/homebrew/bin/pdftotext', '/usr/local/bin/pdftotext'].find((b) => existsSync(b));
    if (pdftotext) {
      const f = path.join(tmp(), 'doc.pdf');
      writeFileSync(f, r.datos);
      const texto = execFileSync(pdftotext, [f, '-'], { encoding: 'utf8' });
      assert.match(texto, /Prueba PDF/);
      assert.match(texto, /NOTA-PERMITIDA/, 'lo de ./trabajo sí se lee');
      assert.match(texto, /JS-OK/, 'el JavaScript propio corre');
      assert.doesNotMatch(texto, /SECRETO/, 'lo de fuera no se lee');
      assert.doesNotMatch(texto, /FILTRADO/, 'nada vino de la red');
    }
    await new Promise((res) => setTimeout(res, 300));
    assert.deepEqual(pedidos, [], 'ningún pedido de red llegó a localhost');
    void cwd;
  } finally {
    servidor.close();
  }
});
