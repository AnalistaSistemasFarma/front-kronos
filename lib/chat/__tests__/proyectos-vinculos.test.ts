import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Vínculos del módulo «Proyectos» (lib/chat/projects-links.ts):
 *   - CORREO: el buzón SIEMPRE es el de la sesión (nunca uno ajeno); sin el
 *     permiso del Correo, 403; un hilo que no está en su buzón, 404; se guarda
 *     solo la copia mínima (nada del cuerpo).
 *   - SOLICITUD: solo un caso en el que la persona participa y de la empresa
 *     del proyecto; si no, 404. Un lector no vincula.
 */
const correoAccess = vi.hoisted(() => vi.fn());
const createEmail = vi.hoisted(() => vi.fn());
const createRequest = vi.hoisted(() => vi.fn());
const findEmail = vi.hoisted(() => vi.fn());
const findRequest = vi.hoisted(() => vi.fn());

vi.mock('../../prisma', () => {
  const tx = {
    chatProjectEmail: { create: createEmail },
    chatProjectRequest: { create: createRequest },
    chatProject: { update: vi.fn() },
  };
  return {
    prisma: {
      chatProjectEmail: { findFirst: findEmail, count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
      chatProjectRequest: { findFirst: findRequest, count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});
vi.mock('../../mssqlPool', () => ({ sql: {}, withMssqlPool: vi.fn() }));
vi.mock('../../correo/db', () => ({ getCorreoAccess: correoAccess, auditar: vi.fn(async () => undefined) }));
vi.mock('../../correo/kronos', () => ({ solicitudVisible: vi.fn() }));

import { LinkError, vincularCorreo, vincularSolicitud } from '../projects-links';
import type { CorreoDeps } from '../../correo/service';

const ANA = { id: 'u-ana', email: 'Ana@GssLatam.com' };
const proyecto = (role: 'owner' | 'editor' | 'reader' = 'editor') => ({ idProject: 7, name: 'Comex', idCompany: 3, profile: 'olp', role, archived: false });
const HILO = 'AAQkADhilo0001';

const mensaje = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  conversationId: HILO,
  internetMessageId: '<x@y>',
  asunto: 'Embarque PO 4500123',
  de: { nombre: 'Agencia Siaco', correo: 'ops@siaco.com.co' },
  fecha: '2026-10-17T15:00:00Z',
  leido: true,
  conAdjuntos: false,
  extracto: 'extracto',
  categorias: [],
  para: [],
  cc: [],
  html: '<p>CUERPO CONFIDENCIAL</p>',
  adjuntos: [],
  ...over,
});

function deps(hilo: (id: string) => unknown[]) {
  const buzones: string[] = [];
  const d = {
    db: {},
    cfg: { modo: 'graph' },
    proveedor: async (acceso: { email: string }) => {
      buzones.push(acceso.email);
      return { mensajes: vi.fn(), hilo: vi.fn(async (id: string) => hilo(id)) };
    },
  } as unknown as CorreoDeps;
  return { d, buzones };
}

beforeEach(() => {
  vi.clearAllMocks();
  correoAccess.mockResolvedValue({ idUser: 'u-ana', nombre: 'Ana', email: 'Ana@GssLatam.com', empresas: [], empresasSolicitud: [] });
  findEmail.mockResolvedValue(null);
  findRequest.mockResolvedValue(null);
  createEmail.mockResolvedValue({ id_project_email: 11 });
  createRequest.mockResolvedValue({ id_project_request: 12 });
});

describe('vincular un correo', () => {
  it('lee el hilo con el buzón de la SESIÓN y guarda solo la copia mínima', async () => {
    const { d, buzones } = deps(() => [mensaje(), mensaje({ id: 'm2', fecha: '2026-10-17T18:00:00Z', de: { nombre: 'Proveedor', correo: 'p@x.com' } })]);
    expect(await vincularCorreo(d, ANA, proyecto(), { conversationId: HILO, summary: 'Faltan documentos' }, null)).toEqual({ id: 11 });
    // El acceso del Correo se pide con el correo de la sesión, y el proveedor se arma con él.
    expect(correoAccess).toHaveBeenCalledWith(expect.anything(), ANA.email);
    expect(buzones).toEqual(['Ana@GssLatam.com']);
    const data = createEmail.mock.calls[0][0].data;
    expect(data).toMatchObject({
      id_project: 7,
      mailbox: 'ana@gsslatam.com',
      conversation_id: HILO,
      subject: 'Embarque PO 4500123',
      sender_name: 'Proveedor',
      sender_email: 'p@x.com',
      message_count: 2,
      summary: 'Faltan documentos',
      linked_by: 'u-ana',
    });
    // Nada del cuerpo sale del buzón.
    expect(JSON.stringify(data)).not.toMatch(/CONFIDENCIAL/);
  });

  it('un hilo que no está en SU buzón: 404 y no se guarda nada', async () => {
    const { d } = deps(() => []);
    await expect(vincularCorreo(d, ANA, proyecto(), { conversationId: HILO, summary: null }, null)).rejects.toMatchObject({ status: 404 });
    expect(createEmail).not.toHaveBeenCalled();
  });

  it('sin el permiso del módulo Correo: 403', async () => {
    correoAccess.mockResolvedValue(null);
    const { d } = deps(() => [mensaje()]);
    await expect(vincularCorreo(d, ANA, proyecto(), { conversationId: HILO, summary: null }, null)).rejects.toMatchObject({ status: 403 });
  });

  it('un lector no vincula (ni se toca el buzón)', async () => {
    const { d, buzones } = deps(() => [mensaje()]);
    await expect(vincularCorreo(d, ANA, proyecto('reader'), { conversationId: HILO, summary: null }, null)).rejects.toBeInstanceOf(LinkError);
    expect(buzones).toEqual([]);
    expect(correoAccess).not.toHaveBeenCalled();
  });

  it('el mismo hilo dos veces: 409', async () => {
    findEmail.mockResolvedValue({ id_project_email: 3 });
    const { d } = deps(() => [mensaje()]);
    await expect(vincularCorreo(d, ANA, proyecto(), { conversationId: HILO, summary: null }, null)).rejects.toMatchObject({ status: 409 });
  });

  it('un id de hilo inválido no llega al proveedor', async () => {
    const { d, buzones } = deps(() => [mensaje()]);
    await expect(vincularCorreo(d, ANA, proyecto(), { conversationId: "x' or 1=1", summary: null }, null)).rejects.toBeTruthy();
    expect(buzones).toEqual([]);
  });
});

describe('vincular una solicitud', () => {
  const visible = vi.fn();
  beforeEach(() => visible.mockReset());

  it('solo si la persona participa en el caso y es de la empresa del proyecto', async () => {
    visible.mockResolvedValue({ id: 5, asunto: 'Proveedor nuevo', idCompany: 3, estado: 1, proceso: 'Datos maestros SAP' });
    expect(await vincularSolicitud(ANA, proyecto(), 5, visible)).toEqual({ id: 12 });
    expect(visible).toHaveBeenCalledWith('u-ana', 5);
    expect(createRequest.mock.calls[0][0].data).toMatchObject({ id_project: 7, id_request: 5, id_company: 3, subject: 'Proveedor nuevo', linked_by: 'u-ana' });
  });

  it('un caso ajeno: 404 (no se confirma que exista)', async () => {
    visible.mockResolvedValue(null);
    await expect(vincularSolicitud(ANA, proyecto(), 5, visible)).rejects.toMatchObject({ status: 404 });
    expect(createRequest).not.toHaveBeenCalled();
  });

  it('un caso de OTRA empresa: 404', async () => {
    visible.mockResolvedValue({ id: 5, asunto: 'x', idCompany: 9, estado: 1 });
    await expect(vincularSolicitud(ANA, proyecto(), 5, visible)).rejects.toMatchObject({ status: 404 });
  });

  it('un lector no vincula', async () => {
    await expect(vincularSolicitud(ANA, proyecto('reader'), 5, visible)).rejects.toMatchObject({ status: 403 });
    expect(visible).not.toHaveBeenCalled();
  });
});
