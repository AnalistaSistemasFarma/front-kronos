import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ruta de MENSAJES DE CUMPLEAÑOS (Cristian Baldión, 2026-10-20): sesión y servicio SIMULADOS.

const { identificar, resolverNombreEstudiante, mensajesVisibles, enviarMensaje, borrarMensaje } = vi.hoisted(() => ({
  identificar: vi.fn(),
  resolverNombreEstudiante: vi.fn(),
  mensajesVisibles: vi.fn(),
  enviarMensaje: vi.fn(),
  borrarMensaje: vi.fn(),
}));
vi.mock('@/lib/portal/acceso', () => ({ identificar }));
vi.mock('@/lib/portal/formacion', () => ({ resolverNombreEstudiante }));
vi.mock('@/lib/portal/mensajes-cumple-servidor', async (original) => ({
  ...(await original<typeof import('@/lib/portal/mensajes-cumple-servidor')>()),
  mensajesVisibles,
  enviarMensaje,
  borrarMensaje,
}));

import { NextRequest } from 'next/server';
import { FormacionStorageError, FormacionStorageNoConfigurado } from '@/lib/portal/formacion-storage';
import { ErrorMensaje } from '@/lib/portal/mensajes-cumple-servidor';
import { DELETE, GET, POST } from '../route';

const url = (q = '') => new URL(`/api/portal/mensajes-cumple${q}`, 'http://localhost');
const get = (q = '') => new NextRequest(url(q));
const post = (cuerpo: unknown) => new NextRequest(url(), { method: 'POST', body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), headers: { 'Content-Type': 'application/json' } });
const borrar = (q: string) => new NextRequest(url(q), { method: 'DELETE' });
const CUERPO = { fecha: '2026-10-19', nombre: 'PEREZ GOMEZ ANA', empresa: 'GSS', texto: '¡Feliz cumpleaños! 🎉' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  identificar.mockResolvedValue({ correo: 'carlos@gsslatam.com', via: 'codigo' });
  resolverNombreEstudiante.mockResolvedValue('Carlos Ruiz');
  mensajesVisibles.mockResolvedValue({ mensajes: [{ id: 'x.json', paraNombre: 'A', paraEmpresa: 'E', deNombre: 'Carlos Ruiz', texto: 'hola', enviadoEl: '2026-10-19T15:00:00Z' }], puedeModerar: false });
  enviarMensaje.mockResolvedValue(undefined);
  borrarMensaje.mockResolvedValue(undefined);
});

describe('sin sesión', () => {
  it('GET, POST y DELETE responden 401 y no llegan al servicio', async () => {
    identificar.mockResolvedValue(null);
    expect((await GET(get('?fecha=2026-10-19'))).status).toBe(401);
    expect((await POST(post(CUERPO))).status).toBe(401);
    expect((await DELETE(borrar('?fecha=2026-10-19&id=x.json'))).status).toBe(401);
    expect(mensajesVisibles).not.toHaveBeenCalled();
    expect(enviarMensaje).not.toHaveBeenCalled();
    expect(borrarMensaje).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('le pasa al servicio el correo de la SESIÓN y la fecha, y responde sin caché', async () => {
    const res = await GET(get('?fecha=2026-10-19'));
    expect(res.status).toBe(200);
    expect(mensajesVisibles).toHaveBeenCalledWith({ correo: 'carlos@gsslatam.com', fecha: '2026-10-19' });
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect((await res.json()).mensajes).toHaveLength(1);
  });
  it('un correo mandado por el navegador NO cambia de quién se leen los mensajes', async () => {
    await GET(get('?fecha=2026-10-19&correo=ana.perez@gsslatam.com&para=ana.perez@gsslatam.com'));
    expect(mensajesVisibles).toHaveBeenCalledWith({ correo: 'carlos@gsslatam.com', fecha: '2026-10-19' });
  });
});

describe('POST', () => {
  it('envía con el correo y el nombre de la SESIÓN (nunca los del cuerpo) y responde 201', async () => {
    const res = await POST(post({ ...CUERPO, correo: 'otro@x.com', nombreRemitente: 'Suplantado' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(enviarMensaje).toHaveBeenCalledWith({ correo: 'carlos@gsslatam.com', nombreRemitente: 'Carlos Ruiz', fecha: CUERPO.fecha, nombre: CUERPO.nombre, empresa: CUERPO.empresa, texto: CUERPO.texto });
    expect(resolverNombreEstudiante).toHaveBeenCalledWith('carlos@gsslatam.com');
  });
  it('un cuerpo que no es JSON o no es un objeto: 400 y no llega al servicio', async () => {
    for (const cuerpo of ['esto no es json', 'null', '"texto"']) {
      const r = await POST(post(cuerpo));
      expect(r.status, cuerpo).toBe(400);
    }
    expect(enviarMensaje).not.toHaveBeenCalled();
  });
  it('las reglas del servicio se devuelven con su código y su mensaje (400, 404, 429)', async () => {
    for (const [estado, mensaje] of [[400, 'El mensaje admite máximo 500 caracteres.'], [404, 'Esa persona no cumple años ese día.'], [429, 'Ya dejó 3 mensajes a esta persona hoy. Gracias por su cariño.']] as const) {
      enviarMensaje.mockRejectedValueOnce(new ErrorMensaje(estado, mensaje));
      const r = await POST(post(CUERPO));
      expect(r.status).toBe(estado);
      expect((await r.json()).error).toBe(mensaje);
    }
  });
});

describe('DELETE', () => {
  it('pasa la fecha y el id con el correo de la sesión; el servicio decide si es administrador', async () => {
    const res = await DELETE(borrar('?fecha=2026-10-19&id=abc.json'));
    expect(res.status).toBe(200);
    expect(borrarMensaje).toHaveBeenCalledWith({ correo: 'carlos@gsslatam.com', fecha: '2026-10-19', id: 'abc.json' });
    borrarMensaje.mockRejectedValueOnce(new ErrorMensaje(403, 'Solo el administrador puede borrar mensajes.'));
    expect((await DELETE(borrar('?fecha=2026-10-19&id=abc.json'))).status).toBe(403);
  });
});

describe('errores de SharePoint', () => {
  it('sin configurar: 503; sin permiso: 502 con el aviso al equipo; cualquier otro: 502 genérico, sin detalles ni datos de nadie', async () => {
    enviarMensaje.mockRejectedValueOnce(new FormacionStorageNoConfigurado('Faltan variables: X'));
    expect((await POST(post(CUERPO))).status).toBe(503);

    enviarMensaje.mockRejectedValueOnce(new FormacionStorageError('Graph 403 secreto', 403));
    let r: Response = await POST(post(CUERPO));
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe('El portal no tiene permiso para guardar mensajes en SharePoint. Avise a Tecnología.');

    mensajesVisibles.mockRejectedValueOnce(new Error('boom con ana.perez@gsslatam.com'));
    r = await GET(get('?fecha=2026-10-19'));
    const cuerpo = await r.json();
    expect(r.status).toBe(502);
    expect(JSON.stringify(cuerpo)).not.toMatch(/boom|ana\.perez|secreto/);
  });
});
