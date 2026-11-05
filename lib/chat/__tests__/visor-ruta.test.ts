import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * GET /api/chat/attachments/<id>/vista (2026-10-22) — la reja y los tipos:
 *   - sin sesión: 401 sin mirar el adjunto;
 *   - adjunto inexistente o de una conversación ajena: 404 (mismo cuerpo);
 *   - la puerta es guardConversation sobre la conversación DEL ADJUNTO;
 *   - cada tipo responde lo suyo (PDF de Graph, hojas, texto, medio con rango, 415);
 *   - nada se sirve con el tipo original peligroso (un .html sale como texto plano).
 */
const r = vi.hoisted(() => ({
  sesion: vi.fn(),
  guard: vi.fn(),
  adjunto: vi.fn(),
  bajar: vi.fn(),
  pdf: vi.fn(),
  hojas: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({ prisma: { chatAttachment: { findUnique: r.adjunto } } }));
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, resolveSessionUser: r.sesion, guardConversation: r.guard };
});
vi.mock('../attachmentStorage', () => ({ downloadChatAttachment: r.bajar }));
vi.mock('../visor-servidor', () => ({ pdfDeAdjunto: r.pdf, hojasDeAdjunto: r.hojas }));

import { NextRequest, NextResponse } from 'next/server';
import { GET } from '../../../app/api/chat/attachments/[id]/vista/route';

const pedir = (id = '42', qs = '', headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://x/api/chat/attachments/${id}/vista${qs}`, { headers }), { params: Promise.resolve({ id }) });

const fila = (file_name: string, content_type: string | null = null) => ({
  file_name,
  content_type,
  onedrive_item_id: 'ITEM-1',
  message: { id_conversation: 7 },
});
const stream = (texto: string) => new Response(texto).body as ReadableStream<Uint8Array>;
const contenido = (texto: string, extra: Record<string, unknown> = {}) => ({
  stream: stream(texto),
  contentLength: String(texto.length),
  status: 200,
  contentRange: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  r.sesion.mockResolvedValue({ id: 'yo', email: 'yo@x' });
  r.guard.mockResolvedValue({ user: { id: 'yo', email: 'yo@x' }, conversationId: 7, kind: 'direct', idAgent: 3 });
});

describe('permisos', () => {
  it('sin sesión: 401 y ni siquiera busca el adjunto', async () => {
    r.sesion.mockResolvedValue(null);
    const res = await pedir();
    expect(res.status).toBe(401);
    expect(r.adjunto).not.toHaveBeenCalled();
  });

  it('id inválido: 404', async () => {
    expect((await pedir('abc')).status).toBe(404);
    expect((await pedir('0')).status).toBe(404);
    expect(r.adjunto).not.toHaveBeenCalled();
  });

  it('no existe: 404', async () => {
    r.adjunto.mockResolvedValue(null);
    const res = await pedir();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Adjunto no encontrado.' });
  });

  it('conversación ajena (la puerta del hilo dice que no): el MISMO 404, sin tocar Graph', async () => {
    r.adjunto.mockResolvedValue(fila('acta.docx'));
    r.guard.mockResolvedValue({ response: NextResponse.json({ error: 'Conversación no encontrada.' }, { status: 404 }) });
    const res = await pedir();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Adjunto no encontrado.' });
    expect(r.guard).toHaveBeenCalledWith('7');
    expect(r.pdf).not.toHaveBeenCalled();
    expect(r.bajar).not.toHaveBeenCalled();
  });

  it('vale para grupos, personas y proyectos: la misma puerta del hilo', async () => {
    r.adjunto.mockResolvedValue(fila('nota.txt'));
    r.bajar.mockResolvedValue(contenido('hola'));
    for (const kind of ['group', 'people', 'project']) {
      r.guard.mockResolvedValueOnce({ user: { id: 'yo', email: 'yo@x' }, conversationId: 7, kind });
      r.bajar.mockResolvedValueOnce(contenido('hola'));
      expect((await pedir()).status).toBe(200);
    }
  });
});

describe('tipos', () => {
  it('Word: PDF convertido por Graph, en línea y sin ejecución', async () => {
    r.adjunto.mockResolvedValue(fila('acta.docx'));
    r.pdf.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(r.pdf).toHaveBeenCalledWith('ITEM-1');
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^inline; filename="acta\.pdf"/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('conversión fallida: 502 con mensaje', async () => {
    r.adjunto.mockResolvedValue(fila('deck.pptx'));
    r.pdf.mockRejectedValue(new Error('HTTP 500'));
    const res = await pedir();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/vista previa/);
  });

  it('Excel demasiado grande para PDF (XLSPageLimitExceeded de Office): 422 que no invita a reintentar', async () => {
    r.adjunto.mockResolvedValue(fila('META CARTERA OCTUBRE 2026.xlsx'));
    r.pdf.mockRejectedValue(new Error('OneDrive no pudo convertir el archivo a PDF (HTTP 406, XLSPageLimitExceeded)'));
    const res = await pedir('42', '?como=pdf');
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/límite de páginas/);
  });

  it('Excel: las hojas en JSON; con ?como=pdf, el PDF de Graph', async () => {
    r.adjunto.mockResolvedValue(fila('libro.xlsx'));
    r.hojas.mockResolvedValue({ hojas: [{ nombre: 'H1', html: '<table></table>' }], css: '' });
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hojas: [{ nombre: 'H1', html: '<table></table>' }], css: '' });

    r.pdf.mockResolvedValue(new Uint8Array([1]));
    const pdf = await pedir('42', '?como=pdf');
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(r.pdf).toHaveBeenCalledTimes(1);
  });

  it('Excel que no se puede leer: 422 con usarPdf para que el visor caiga al PDF', async () => {
    r.adjunto.mockResolvedValue(fila('danado.xlsx'));
    r.hojas.mockRejectedValue(new Error('zip inválido'));
    const res = await pedir();
    expect(res.status).toBe(422);
    expect((await res.json()).usarPdf).toBe(true);
  });

  it('Markdown, CSV, código y HTML: siempre text/plain (nunca se interpretan)', async () => {
    for (const [nombre, tipo] of [
      ['LEEME.md', 'text/markdown'],
      ['datos.csv', 'text/csv'],
      ['q.sql', null],
      ['pagina.html', 'text/html'],
    ] as const) {
      r.adjunto.mockResolvedValueOnce(fila(nombre, tipo));
      r.bajar.mockResolvedValueOnce(contenido('# hola'));
      const res = await pedir();
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(await res.text()).toBe('# hola');
    }
  });

  it('texto más grande que el tope: se recorta y se avisa', async () => {
    r.adjunto.mockResolvedValue(fila('grande.log'));
    r.bajar.mockResolvedValue(contenido('x'.repeat(2 * 1024 * 1024 + 10)));
    const res = await pedir();
    expect(res.headers.get('x-visor-recortado')).toBe('1');
    expect((await res.arrayBuffer()).byteLength).toBe(2 * 1024 * 1024);
  });

  it('video: pasa el rango a Graph y responde 206 con Content-Range', async () => {
    r.adjunto.mockResolvedValue(fila('clip.mp4', 'video/mp4'));
    r.bajar.mockResolvedValue(contenido('abc', { status: 206, contentRange: 'bytes 0-2/1000', contentLength: '3' }));
    const res = await pedir('42', '', { range: 'bytes=0-2' });
    expect(r.bajar).toHaveBeenCalledWith('ITEM-1', 'bytes=0-2');
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-2/1000');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('video/mp4');
  });

  it('un rango mal formado no se reenvía', async () => {
    r.adjunto.mockResolvedValue(fila('clip.mp4'));
    r.bajar.mockResolvedValue(contenido('abc'));
    await pedir('42', '', { range: 'bytes=0-2, 5-9' });
    expect(r.bajar).toHaveBeenCalledWith('ITEM-1', null);
  });

  it('a un documento no se le pasa el rango', async () => {
    r.adjunto.mockResolvedValue(fila('informe.pdf'));
    r.bajar.mockResolvedValue(contenido('%PDF-'));
    const res = await pedir('42', '', { range: 'bytes=0-2' });
    expect(r.bajar).toHaveBeenCalledWith('ITEM-1', null);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
  });

  it('imagen en línea; tipo sin vista previa: 415 sin tocar Graph', async () => {
    r.adjunto.mockResolvedValueOnce(fila('foto.jpg', 'image/jpeg'));
    r.bajar.mockResolvedValueOnce(contenido('jpg'));
    expect((await pedir()).headers.get('content-type')).toBe('image/jpeg');

    r.adjunto.mockResolvedValueOnce(fila('cosas.zip', 'application/zip'));
    const res = await pedir();
    expect(res.status).toBe(415);
    expect(r.bajar).toHaveBeenCalledTimes(1);
  });

  it('Graph no entrega el archivo: 502', async () => {
    r.adjunto.mockResolvedValue(fila('nota.txt'));
    r.bajar.mockResolvedValue(null);
    expect((await pedir()).status).toBe(502);
  });
});
