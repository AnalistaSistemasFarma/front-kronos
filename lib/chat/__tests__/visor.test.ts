import { describe, expect, it } from 'vitest';
import {
  lenguajeDe,
  parsearCsv,
  resaltar,
  separadorCsv,
  tipoDeVisor,
  tipoMedioEnLinea,
  urlVistaAdjunto,
} from '../visor';
import { CacheVisor, partirHojas } from '../visor-servidor';

/*
 * Visores de adjuntos del chat (2026-10-22) — reglas puras: qué visor le toca
 * a cada archivo, la URL de la vista, CSV a tabla, resaltado básico, la
 * división de las hojas del Excel y la caché de lo convertido.
 */
describe('tipoDeVisor', () => {
  it.each([
    ['foto.PNG', null, 'imagen'],
    ['informe.pdf', 'application/octet-stream', 'pdf'],
    ['acta.docx', null, 'office'],
    ['viejo.doc', null, 'office'],
    ['deck.pptx', null, 'office'],
    ['libro.xls', null, 'office'],
    ['libro.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'hoja'],
    ['macro.xlsm', null, 'hoja'],
    ['LEEME.md', 'application/octet-stream', 'markdown'],
    ['datos.csv', 'application/vnd.ms-excel', 'csv'],
    ['datos.tsv', null, 'csv'],
    ['consulta.sql', null, 'texto'],
    ['servicio.ts', 'video/mp2t', 'texto'],
    ['config.json', null, 'texto'],
    ['nota.txt', null, 'texto'],
    ['logo.svg', 'image/svg+xml', 'texto'],
    ['pagina.html', 'text/html', 'texto'],
    ['clip.mp4', null, 'video'],
    ['nota-de-voz.webm', 'audio/webm', 'audio'],
    ['pantalla.webm', 'video/webm', 'video'],
    ['cancion.mp3', null, 'audio'],
    ['comprimido.zip', 'application/zip', 'ninguno'],
    ['programa.exe', null, 'ninguno'],
    ['sin-extension', 'application/pdf', 'pdf'],
    ['sin-extension', 'text/plain', 'texto'],
    ['sin-extension', null, 'ninguno'],
  ])('%s (%s) → %s', (nombre, tipo, esperado) => {
    expect(tipoDeVisor(tipo, nombre)).toBe(esperado);
  });

  it('SVG nunca es imagen (es un documento con scripts): se ve como texto de marcado', () => {
    expect(tipoDeVisor('image/svg+xml', 'x.svg')).toBe('texto');
    expect(lenguajeDe('x.svg')).toBe('marcado');
  });

  it('tipo de medio en línea: solo audio y video', () => {
    expect(tipoMedioEnLinea(null, 'a.mp4')).toBe('video/mp4');
    expect(tipoMedioEnLinea('audio/webm', 'a.webm')).toBe('audio/webm');
    expect(tipoMedioEnLinea('', 'a.webm')).toBe('video/webm');
    expect(tipoMedioEnLinea('text/html', 'a.html')).toBeNull();
    expect(tipoMedioEnLinea(null, 'a.pdf')).toBeNull();
  });
});

describe('urlVistaAdjunto', () => {
  it('solo para la ruta de adjuntos del chat', () => {
    expect(urlVistaAdjunto('/api/chat/attachments/42')).toBe('/api/chat/attachments/42/vista');
    expect(urlVistaAdjunto('/api/chat/attachments/42', 'pdf')).toBe('/api/chat/attachments/42/vista?como=pdf');
    expect(urlVistaAdjunto('/api/proyectos/1/archivos/2')).toBeNull();
    expect(urlVistaAdjunto('https://onedrive/x')).toBeNull();
    expect(urlVistaAdjunto('/api/chat/attachments/42?inline=1')).toBeNull();
    expect(urlVistaAdjunto(null)).toBeNull();
  });
});

describe('CSV', () => {
  it('detecta el separador y respeta comillas, comillas escapadas y saltos dentro de comillas', () => {
    const csv = '﻿nombre;valor;nota\r\n"Pérez; Ana";10;"dijo ""hola"""\r\nB;2;"dos\nlíneas"\n';
    const sep = separadorCsv(csv);
    expect(sep).toBe(';');
    const { filas, recortado } = parsearCsv(csv, sep);
    expect(recortado).toBe(false);
    expect(filas).toEqual([
      ['nombre', 'valor', 'nota'],
      ['Pérez; Ana', '10', 'dijo "hola"'],
      ['B', '2', 'dos\nlíneas'],
    ]);
  });

  it('.tsv usa tabulador y el tope de filas recorta', () => {
    expect(separadorCsv('a,b\tc', 'x.tsv')).toBe('\t');
    const grande = Array.from({ length: 10 }, (_, i) => `${i},x`).join('\n');
    const r = parsearCsv(grande, ',', 3);
    expect(r.filas).toHaveLength(3);
    expect(r.recortado).toBe(true);
  });
});

describe('resaltar', () => {
  const texto = (f: { texto: string }[]) => f.map((x) => x.texto).join('');

  it('nunca pierde ni agrega caracteres', () => {
    const muestras: [string, Parameters<typeof resaltar>[1]][] = [
      ['SELECT a, \'x\' FROM t -- comentario\nWHERE id = 3.5 /* bloque */', 'sql'],
      ['const a = "hola" // fin\nlet b = 1e-3; `plantilla ${a}`', 'codigo'],
      ['{"a": [1, true, null, "x\\"y"]}', 'json'],
      ['<a href="x">texto</a><!-- nota -->', 'marcado'],
      ['texto plano', 'plano'],
      ['"sin cerrar', 'codigo'],
    ];
    for (const [t, l] of muestras) expect(texto(resaltar(t, l))).toBe(t);
  });

  it('clasifica palabras clave, cadenas, números y comentarios', () => {
    const f = resaltar("SELECT nombre FROM t WHERE id = 42 -- x", 'sql');
    expect(f).toContainEqual({ clase: 'clave', texto: 'SELECT' });
    expect(f).toContainEqual({ clase: 'numero', texto: '42' });
    expect(f).toContainEqual({ clase: 'comentario', texto: '-- x' });
    const j = resaltar('{"a": 1}', 'json');
    expect(j).toContainEqual({ clase: 'cadena', texto: '"a"' });
    expect(resaltar('x1 = 2', 'codigo')).not.toContainEqual({ clase: 'numero', texto: '1' });
  });
});

describe('partirHojas (Excel en pestañas)', () => {
  it('una entrada por hoja, con el nombre desescapado y sin el título en el cuerpo', () => {
    const html =
      '<h2 class="sgc-hoja-nombre">Ventas &amp; costos</h2><table class="sgc-hoja"><tr><td>1</td></tr></table>' +
      '<h2 class="sgc-hoja-nombre sgc-hoja-sig">Hoja &lt;2&gt;</h2><p>(Hoja vacía)</p>';
    const hojas = partirHojas(html);
    expect(hojas).toEqual([
      { nombre: 'Ventas & costos', html: '<table class="sgc-hoja"><tr><td>1</td></tr></table>' },
      { nombre: 'Hoja <2>', html: '<p>(Hoja vacía)</p>' },
    ]);
  });
});

describe('CacheVisor', () => {
  it('guarda, vence y expulsa por bytes (LRU)', async () => {
    let ahora = 0;
    const c = new CacheVisor(10, 8, 100, () => ahora);
    c.guardar('a', new Uint8Array(4));
    c.guardar('b', new Uint8Array(4));
    expect(c.leer('a')).not.toBeNull(); // «a» pasa a ser la más reciente
    c.guardar('c', new Uint8Array(4)); // 12 > 10: sale la menos usada («b»)
    expect(c.leer('b')).toBeNull();
    expect(c.leer('a')).not.toBeNull();
    expect(c.tamano).toBe(8);
    c.guardar('enorme', new Uint8Array(9)); // más que el tope por entrada: no se guarda
    expect(c.leer('enorme')).toBeNull();
    ahora = 101;
    expect(c.leer('a')).toBeNull();
  });

  it('comparte la conversión en vuelo y la reutiliza', async () => {
    const c = new CacheVisor();
    let llamadas = 0;
    const producir = async () => {
      llamadas++;
      return new Uint8Array([1, 2, 3]);
    };
    const [x, y] = await Promise.all([c.obtener('k', producir), c.obtener('k', producir)]);
    expect(x).toEqual(y);
    await c.obtener('k', producir);
    expect(llamadas).toBe(1);
  });

  it('un error no queda en caché', async () => {
    const c = new CacheVisor();
    await expect(c.obtener('k', async () => Promise.reject(new Error('Graph caído')))).rejects.toThrow('Graph caído');
    expect(await c.obtener('k', async () => new Uint8Array([7]))).toEqual(new Uint8Array([7]));
  });
});
