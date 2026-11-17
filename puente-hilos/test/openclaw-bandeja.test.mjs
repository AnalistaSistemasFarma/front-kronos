import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copiarABandeja, dirBandeja, podarBandeja, prepararPdf } from '../src/openclaw/bandeja.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'puente-bandeja-'));

test('dirBandeja: workspace del outbox + inbox/<prefijo sin guion final>; sin outbox no hay bandeja', () => {
  assert.equal(dirBandeja('/u/.openclaw/workspace-kepler/outbox', 'proyecto-pruebas-'), '/u/.openclaw/workspace-kepler/inbox/proyecto-pruebas');
  assert.equal(dirBandeja('/u/.openclaw/workspace/outbox', ''), '/u/.openclaw/workspace/inbox/proyecto');
  assert.equal(dirBandeja(null, 'proyecto-produccion-'), null);
  assert.equal(dirBandeja('relativa/outbox', 'x-'), null);
});

test('copiarABandeja: copia al workspace, conserva el original y agrega el texto de los PDF', async () => {
  const raiz = tmp();
  const adj = path.join(raiz, 'conv', 'adjuntos');
  mkdirSync(adj, { recursive: true });
  const pdf = path.join(adj, '12-factura.pdf');
  const xlsx = path.join(adj, '13-ventas.xlsx');
  writeFileSync(pdf, '%PDF-1.7 prueba');
  writeFileSync(xlsx, 'PK');
  const dir = path.join(raiz, 'workspace', 'inbox', 'proyecto-pruebas');
  const preparados = [];
  const lineas = await copiarABandeja({
    adjuntos: [pdf, xlsx],
    dir,
    idConversation: 166,
    preparar: async (copia) => {
      preparados.push(copia);
      writeFileSync(`${copia}.txt`, 'FACTURA FEOL-4218');
      return { texto: `${copia}.txt`, paginas: [] };
    },
  });
  const copiaPdf = path.join(dir, 'c166-12-factura.pdf');
  const copiaXlsx = path.join(dir, 'c166-13-ventas.xlsx');
  assert.ok(existsSync(copiaPdf) && existsSync(copiaXlsx));
  assert.ok(existsSync(pdf), 'el original no se toca');
  assert.deepEqual(preparados, [copiaPdf], 'solo el PDF se prepara');
  assert.match(lineas[0], new RegExp(`^${copiaPdf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
  assert.match(lineas[0], /texto extraído: .*c166-12-factura\.pdf\.txt \(ábralo con read; no use la herramienta pdf\)/);
  assert.equal(lineas[1], copiaXlsx);
});

test('copiarABandeja: sin bandeja (agente sin outbox) devuelve las rutas originales', async () => {
  const lineas = await copiarABandeja({ adjuntos: ['/a/b.pdf'], dir: null, idConversation: 1 });
  assert.deepEqual(lineas, ['/a/b.pdf']);
});

test('copiarABandeja: un archivo que no se puede copiar queda con su ruta original', async () => {
  const raiz = tmp();
  const logs = [];
  const lineas = await copiarABandeja({ adjuntos: [path.join(raiz, 'no-existe.pdf')], dir: path.join(raiz, 'b'), idConversation: 2, log: (m) => logs.push(m) });
  assert.deepEqual(lineas, [path.join(raiz, 'no-existe.pdf')]);
  assert.equal(logs.length, 1);
});

test('podarBandeja: borra solo lo de más de 7 días', () => {
  const dir = tmp();
  const viejo = path.join(dir, 'c1-viejo.pdf');
  const nuevo = path.join(dir, 'c1-nuevo.pdf');
  writeFileSync(viejo, 'x');
  writeFileSync(nuevo, 'x');
  const hace8 = (Date.now() - 8 * 86_400_000) / 1000;
  utimesSync(viejo, hace8, hace8);
  assert.equal(podarBandeja(dir), 1);
  assert.ok(!existsSync(viejo) && existsSync(nuevo));
  assert.equal(podarBandeja(null), 0);
});

test('prepararPdf: escribe <pdf>.txt; si casi no hay texto, pide las páginas como imagen', async () => {
  const dir = tmp();
  const pdf = path.join(dir, 'escaneado.pdf');
  writeFileSync(pdf, '%PDF-1.7');
  const clawpdf = path.join(dir, 'cli.js');
  writeFileSync(clawpdf, '');
  process.env.HILOS_OPENCLAW_CLAWPDF = clawpdf;
  try {
    const llamadas = [];
    const run = async (_bin, args) => {
      llamadas.push(args[1]);
      if (args[1] === 'render') {
        const destino = args[args.indexOf('-o') + 1];
        if (args[args.indexOf('--page') + 1] === '3') return null;
        writeFileSync(destino, 'png');
        return '';
      }
      return '   ';
    };
    const r = await prepararPdf(pdf, { run });
    assert.equal(r.texto, `${pdf}.txt`);
    assert.equal(readFileSync(r.texto, 'utf8'), '   ');
    assert.deepEqual(r.paginas, [`${pdf}-p1.png`, `${pdf}-p2.png`]);
    assert.deepEqual(llamadas, ['extract', 'render', 'render', 'render']);

    const conTexto = path.join(dir, 'texto.pdf');
    writeFileSync(conTexto, '%PDF-1.7');
    const r2 = await prepararPdf(conTexto, { run: async () => 'x'.repeat(500) });
    assert.deepEqual(r2.paginas, []);
  } finally {
    delete process.env.HILOS_OPENCLAW_CLAWPDF;
  }
});
