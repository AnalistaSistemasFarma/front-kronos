import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * «Mis stickers» (2026-10-21) — rutas con la base simulada:
 *   - cargar valida los BYTES y deja la imagen en chat_sticker (id_company
 *     NULL) + la marca personal, en una transacción;
 *   - el selector nunca muestra el sticker personal de otra persona como «de
 *     todas las empresas»;
 *   - proponer solo a una empresa propia y solo el dueño;
 *   - revisar propuestas es de administradores; aprobar COPIA el sticker a la empresa.
 */
const r = vi.hoisted(() => ({
  usuario: vi.fn(),
  acceso: vi.fn(),
  admin: vi.fn(),
  stickerCreate: vi.fn(),
  stickerFindMany: vi.fn(),
  personalCreate: vi.fn(),
  personalCount: vi.fn(),
  personalFindMany: vi.fn(),
  personalFindUnique: vi.fn(),
  personalUpdate: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => {
  const tx = {
    chatSticker: { create: r.stickerCreate },
    chatStickerPersonal: { create: r.personalCreate, findUnique: r.personalFindUnique, update: r.personalUpdate },
  };
  return {
    prisma: {
      chatSticker: { findMany: r.stickerFindMany },
      chatStickerPersonal: {
        count: r.personalCount,
        findMany: r.personalFindMany,
        findUnique: r.personalFindUnique,
        update: r.personalUpdate,
      },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    },
  };
});
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, resolveSessionUser: r.usuario };
});
vi.mock('../media-access', () => ({ accesoAMedia: r.acceso }));
vi.mock('../../access-control', () => ({ checkAdminPrivileges: r.admin }));

import { NextRequest } from 'next/server';
import { POST as subir } from '../../../app/api/chat/stickers/mios/route';
import { POST as proponer } from '../../../app/api/chat/stickers/mios/[id]/propuesta/route';
import { GET as propuestas } from '../../../app/api/chat/stickers/propuestas/route';
import { POST as revisar } from '../../../app/api/chat/stickers/propuestas/[id]/route';
import { GET as catalogo } from '../../../app/api/chat/stickers/route';

const raiz = path.resolve(__dirname, '../../..');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- archivo versionado.
const WEBP_ANIMADO = readFileSync(path.join(raiz, 'public/chat/stickers/noto/aplausos.webp'));

function formulario(bytes: Uint8Array, nombre: string, tipo = 'image/webp') {
  const form = new FormData();
  form.append('archivo', new Blob([new Uint8Array(bytes)], { type: tipo }), 'x.webp');
  form.append('nombre', nombre);
  return new NextRequest('http://x/api/chat/stickers/mios', { method: 'POST', body: form });
}
const json = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const f of Object.values(r)) f.mockReset();
  r.usuario.mockResolvedValue({ id: 'yo', email: 'yo@x' });
  r.acceso.mockResolvedValue({ ok: true, empresas: [3], nombresEmpresas: [{ id: 3, nombre: 'ONE LATAM PHARMA' }] });
  r.admin.mockResolvedValue(false);
  r.stickerCreate.mockImplementation(async ({ data }: { data: { label: string } }) => ({ id_sticker: 77, label: data.label }));
  r.personalCount.mockResolvedValue(0);
});

describe('cargar un sticker propio', () => {
  it('WebP animado: imagen en chat_sticker sin empresa + marca personal, en la misma transacción', async () => {
    const res = await subir(formulario(WEBP_ANIMADO, '¡Bravo, equipo!'));
    expect(res.status).toBe(201);
    const data = r.stickerCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ id_company: null, label: '¡Bravo, equipo!', content_type: 'image/webp', created_by: 'yo', size_bytes: WEBP_ANIMADO.length });
    expect(r.personalCreate).toHaveBeenCalledWith({ data: { id_sticker: 77, id_user: 'yo' } });
    expect((await res.json()).sticker).toMatchObject({ idSticker: 77, animated: true, src: '/api/chat/stickers/77' });
  });

  it('un SVG disfrazado de WebP se rechaza y no se escribe nada', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await subir(formulario(svg, 'malo'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/WebP/);
    expect(r.stickerCreate).not.toHaveBeenCalled();
  });

  it('sin nombre o con el cupo lleno: 400', async () => {
    expect((await subir(formulario(WEBP_ANIMADO, '   '))).status).toBe(400);
    r.personalCount.mockResolvedValue(60);
    const res = await subir(formulario(WEBP_ANIMADO, 'otro'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/60 stickers/);
    expect(r.stickerCreate).not.toHaveBeenCalled();
  });

  it('sin chat: 403', async () => {
    r.acceso.mockResolvedValue({ ok: false, empresas: [], nombresEmpresas: [] });
    expect((await subir(formulario(WEBP_ANIMADO, 'x'))).status).toBe(403);
  });
});

describe('selector', () => {
  it('los de empresa excluyen los personales y «Mis stickers» va primero', async () => {
    r.stickerFindMany.mockResolvedValue([{ id_sticker: 5, label: 'Logo OLP', keywords: null }]);
    r.personalFindMany.mockResolvedValue([{ id_sticker: 77, proposal_state: null, proposed_company: null, company: null, sticker: { label: 'Mío', keywords: 'Mío animado propio' } }]);
    const res = await catalogo();
    const data = await res.json();
    expect(r.stickerFindMany.mock.calls[0][0].where).toMatchObject({ active: true, personal: { is: null } });
    expect(r.personalFindMany.mock.calls[0][0].where).toMatchObject({ id_user: 'yo', removed_at: null });
    expect(data.packs.map((p: { id: string }) => p.id)).toEqual(['mios', 'animados', 'gss', 'empresa']);
    expect(data.stickers[0]).toMatchObject({ pack: 'mios', provider: 'empresa', idSticker: 77 });
    expect(data.misStickers).toBe(true);
    expect(data.empresas).toEqual([{ id: 3, nombre: 'ONE LATAM PHARMA' }]);
    expect(data.puedeRevisar).toBe(false);
  });

  it('sin la tabla nueva: no hay «Mis stickers» y los de empresa salen con el filtro del #698', async () => {
    const falta = Object.assign(new Error("Invalid object name 'dbo.chat_sticker_personal'"), { code: 'P2021', meta: { table: 'dbo.chat_sticker_personal' } });
    r.stickerFindMany.mockRejectedValueOnce(falta).mockResolvedValueOnce([]);
    r.personalFindMany.mockRejectedValue(falta);
    const data = await (await catalogo()).json();
    expect(r.stickerFindMany.mock.calls[1][0].where).toEqual({ active: true, OR: [{ id_company: null }, { id_company: { in: [3] } }] });
    expect(data.misStickers).toBe(false);
    expect(data.packs.map((p: { id: string }) => p.id)).toEqual(['animados', 'gss']);
  });
});

describe('proponer y revisar', () => {
  it('solo a una empresa propia y solo el dueño', async () => {
    expect((await proponer(json('http://x', { idCompany: 9 }), params('77'))).status).toBe(400);
    r.personalFindUnique.mockResolvedValue({ id_user: 'otra', removed_at: null, proposal_state: null });
    expect((await proponer(json('http://x', { idCompany: 3 }), params('77'))).status).toBe(404);
    expect(r.personalUpdate).not.toHaveBeenCalled();
    r.personalFindUnique.mockResolvedValue({ id_user: 'yo', removed_at: null, proposal_state: null });
    expect((await proponer(json('http://x', { idCompany: 3 }), params('77'))).status).toBe(200);
    expect(r.personalUpdate.mock.calls[0][0].data).toMatchObject({ proposed_company: 3, proposal_state: 'propuesto' });
  });

  it('revisar es de administradores', async () => {
    expect((await propuestas()).status).toBe(403);
    expect((await revisar(json('http://x', { accion: 'aprobar' }), params('77'))).status).toBe(403);
  });

  it('aprobar COPIA el sticker como sticker de la empresa; la persona conserva el suyo', async () => {
    r.admin.mockResolvedValue(true);
    r.personalFindUnique.mockResolvedValue({
      proposal_state: 'propuesto',
      proposed_company: 3,
      removed_at: null,
      sticker: { label: 'Mío', keywords: 'Mío animado propio', content_type: 'image/webp', image_data: Buffer.from('x'), size_bytes: 1, active: true },
    });
    r.stickerCreate.mockResolvedValue({ id_sticker: 90 });
    const res = await revisar(json('http://x', { accion: 'aprobar' }), params('77'));
    expect(res.status).toBe(200);
    expect(r.stickerCreate.mock.calls[0][0].data).toMatchObject({ id_company: 3, label: 'Mío', created_by: 'yo', keywords: 'Mío animado empresa' });
    expect(r.personalUpdate.mock.calls[0][0].data).toMatchObject({ proposal_state: 'aprobado', reviewed_by: 'yo', id_sticker_company: 90 });
  });

  it('una propuesta ya revisada no se vuelve a revisar (409)', async () => {
    r.admin.mockResolvedValue(true);
    r.personalFindUnique.mockResolvedValue({ proposal_state: 'aprobado', proposed_company: 3, removed_at: null, sticker: { active: true } });
    expect((await revisar(json('http://x', { accion: 'rechazar' }), params('77'))).status).toBe(409);
  });
});
