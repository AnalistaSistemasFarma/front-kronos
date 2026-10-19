import { beforeEach, describe, expect, it, vi } from 'vitest';

// Eliminar (deslizar) y «Deshacer» con la base simulada, el buzón simulado y Graph falso.
const db = vi.hoisted(() => {
  const names = ['vinculosDeHilos', 'proyectosDeHilos', 'auditar'] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});
vi.mock('../db', () => db);

import { readCorreoConfig } from '../config';
import { deshacerEliminar, eliminarMensajes, firmarComprobante, leerComprobante } from '../eliminar';
import { limpiarTokensApp } from '../graph';
import { MockMailProvider, reiniciarBuzonSimulado } from '../mock';
import { estadoConexion, type CorreoDeps } from '../service';
import type { AccesoCorreo } from '../db';

const SECRETO = 'secreto-de-firma-de-pruebas-0123456789';
const yo: AccesoCorreo = { idUser: 'op1', nombre: 'Laura', email: 'laura@gsslatam.com', empresas: [{ idCompany: 1, companyName: 'GSS' }], empresasSolicitud: [{ idCompany: 1, companyName: 'GSS' }] };
const otro: AccesoCorreo = { ...yo, idUser: 'op2', email: 'gerencia@gsslatam.com' };

const graphEnv = {
  CORREO_MODO: 'graph',
  CORREO_INQUILINOS: 'gss',
  CORREO_GSS_TENANT_ID: '3409fd29-f351-4a98-8ef4-d98c8874a836',
  CORREO_GSS_CLIENT_ID: '28c47cc5-342a-4781-909e-d234db1bb993',
  CORREO_GSS_CLIENT_SECRET: 'secreto-de-prueba',
  CORREO_GSS_DOMINIOS: 'gsslatam.com',
};
const BASE = 'https://graph.microsoft.com/v1.0/users/laura%40gsslatam.com';

let reloj = Date.parse('2026-10-18T21:00:00Z');
function deps(env: Record<string, string> = { CORREO_MODO: 'mock' }, extra: Partial<CorreoDeps> = {}): CorreoDeps {
  return {
    db: {} as never,
    cfg: readCorreoConfig(env),
    kronos: {} as never,
    crearSolicitud: vi.fn() as never,
    notificarNueva: vi.fn(),
    subirAdjuntos: vi.fn() as never,
    dominiosGrupo: ['gsslatam.com'],
    secretoFirma: SECRETO,
    now: () => reloj,
    ...extra,
  };
}

const bandeja = async (a = yo) => (await new MockMailProvider(a.email).mensajes({})).mensajes.map((m) => m.id);
const papelera = async (a = yo) => (await new MockMailProvider(a.email).mensajes({ carpetaId: 'mock-folder-deletedAAAA' })).mensajes.map((m) => m.id);
const acciones = () => db.auditar.mock.calls.map((c) => c[1].accion);

beforeEach(() => {
  vi.clearAllMocks();
  reiniciarBuzonSimulado();
  limpiarTokensApp();
  reloj = Date.parse('2026-10-18T21:00:00Z');
  db.vinculosDeHilos.mockResolvedValue(new Map());
  db.proyectosDeHilos.mockResolvedValue(new Map());
  db.auditar.mockResolvedValue(undefined);
});

describe('Correo · eliminar (buzón simulado)', () => {
  it('MUEVE a Elementos eliminados (no borra), con id nuevo, comprobante para deshacer y auditoría', async () => {
    const r = await eliminarMensajes(deps(), yo, ['mock-msg-0003AAAA'], { confirmarVinculados: false }, '10.0.0.9');
    expect(r).toMatchObject({ requiereConfirmacion: false, eliminados: [{ id: 'mock-msg-0003AAAA', nuevoId: 'mock-msg-0003AAAA-ELIM' }], yaEnEliminados: [], fallidos: [] });
    if (r.requiereConfirmacion) throw new Error('no');
    expect(typeof r.deshacer).toBe('string');
    expect(r.venceEn).toBe('2026-10-18T21:05:00.000Z');
    expect(await bandeja()).not.toContain('mock-msg-0003AAAA');
    expect(await papelera()).toEqual(['mock-msg-0003AAAA-ELIM']);
    // El correo sigue existiendo (en la papelera): nada se borró.
    expect((await new MockMailProvider(yo.email).hilo('mock-conv-02AAAA')).map((m) => m.id)).toEqual(['mock-msg-0003AAAA-ELIM']);
    expect(db.auditar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accion: 'ELIMINAR', idUser: 'op1', mailbox: 'laura@gsslatam.com', mensajeId: 'mock-msg-0003AAAA', conversationId: 'mock-conv-02AAAA', internetMessageId: '<mock-3.02@correo.simulado>', ip: '10.0.0.9' })
    );
    expect(db.auditar.mock.calls[0][1].detalle).toMatch(/Movido a Elementos eliminados \(sin borrar\) desde la carpeta mock-folder-inboxAAAA/);
  });

  it('«Deshacer» devuelve el correo a su carpeta de origen y queda auditado', async () => {
    const r = await eliminarMensajes(deps(), yo, ['mock-msg-0003AAAA', 'mock-msg-0005AAAA'], { confirmarVinculados: false }, null);
    if (r.requiereConfirmacion) throw new Error('no');
    const d = await deshacerEliminar(deps(), yo, r.deshacer, '10.0.0.9');
    expect(d.fallidos).toEqual([]);
    expect(d.restaurados).toEqual([
      { id: 'mock-msg-0003AAAA-ELIM', nuevoId: 'mock-msg-0003AAAA' },
      { id: 'mock-msg-0005AAAA-ELIM', nuevoId: 'mock-msg-0005AAAA' },
    ]);
    expect(await bandeja()).toEqual(expect.arrayContaining(['mock-msg-0003AAAA', 'mock-msg-0005AAAA']));
    expect(await papelera()).toEqual([]);
    expect(acciones()).toEqual(['ELIMINAR', 'ELIMINAR', 'RESTAURAR', 'RESTAURAR']);
    // Repetir el mismo «Deshacer» no mueve nada más: ya no están en la papelera.
    const otra = await deshacerEliminar(deps(), yo, r.deshacer, null);
    expect(otra).toEqual({ restaurados: [], fallidos: ['mock-msg-0003AAAA-ELIM', 'mock-msg-0005AAAA-ELIM'] });
  });

  it('lo que ya está en Elementos eliminados no se vuelve a tocar (nunca se borra de forma permanente)', async () => {
    await eliminarMensajes(deps(), yo, ['mock-msg-0003AAAA'], { confirmarVinculados: false }, null);
    db.auditar.mockClear();
    const r = await eliminarMensajes(deps(), yo, ['mock-msg-0003AAAA-ELIM'], { confirmarVinculados: false }, null);
    expect(r).toMatchObject({ eliminados: [], yaEnEliminados: ['mock-msg-0003AAAA-ELIM'], fallidos: [], deshacer: null });
    expect(await papelera()).toEqual(['mock-msg-0003AAAA-ELIM']);
    expect(db.auditar).not.toHaveBeenCalled();
  });

  it('un correo que no es del buzón de la sesión: 404 y nada se mueve; mezclado, sale como fallido', async () => {
    // El correo existe en el buzón simulado de OTRA persona, no en el de la sesión.
    await expect(eliminarMensajes(deps(), yo, ['AAMkDEGERENCIA01'], { confirmarVinculados: false }, null)).rejects.toMatchObject({ status: 404 });
    const r = await eliminarMensajes(deps(), yo, ['AAMkDEGERENCIA01', 'mock-msg-0004AAAA'], { confirmarVinculados: false }, null);
    expect(r).toMatchObject({ eliminados: [{ id: 'mock-msg-0004AAAA' }], fallidos: ['AAMkDEGERENCIA01'] });
  });

  it('hilo vinculado a una solicitud o a un proyecto: pide confirmación; confirmado, mueve y conserva el vínculo', async () => {
    db.vinculosDeHilos.mockResolvedValue(new Map([['mock-conv-01AAAA', { idRequest: 321 }]]));
    db.proyectosDeHilos.mockResolvedValue(new Map([['mock-conv-03AAAA', ['Contratos 2026']]]));
    const r = await eliminarMensajes(deps(), yo, ['mock-msg-0001AAAA', 'mock-msg-0004AAAA', 'mock-msg-0005AAAA'], { confirmarVinculados: false }, null);
    expect(r).toEqual({
      requiereConfirmacion: true,
      vinculos: [
        { mensajeId: 'mock-msg-0001AAAA', conversationId: 'mock-conv-01AAAA', idRequest: 321, proyectos: [] },
        { mensajeId: 'mock-msg-0004AAAA', conversationId: 'mock-conv-03AAAA', idRequest: null, proyectos: ['Contratos 2026'] },
      ],
    });
    expect(await papelera()).toEqual([]);
    expect(db.auditar).not.toHaveBeenCalled();
    // Buzón de la sesión en las dos consultas de vínculos.
    expect(db.vinculosDeHilos).toHaveBeenCalledWith(expect.anything(), 'op1', expect.any(Array));
    expect(db.proyectosDeHilos).toHaveBeenCalledWith(expect.anything(), 'laura@gsslatam.com', expect.any(Array));
    const ok = await eliminarMensajes(deps(), yo, ['mock-msg-0001AAAA'], { confirmarVinculados: true }, null);
    expect(ok).toMatchObject({ eliminados: [{ id: 'mock-msg-0001AAAA' }] });
    expect(db.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'ELIMINAR', idRequest: 321, detalle: expect.stringMatching(/solicitud #321 \(el vínculo se conserva\)/) }));
  });

  it('el comprobante solo sirve a quien eliminó, sin alterar y dentro de la vigencia', async () => {
    const r = await eliminarMensajes(deps(), yo, ['mock-msg-0003AAAA'], { confirmarVinculados: false }, null);
    if (r.requiereConfirmacion || !r.deshacer) throw new Error('no');
    // Otra persona (u otro buzón) con el comprobante ajeno: 403.
    await expect(deshacerEliminar(deps(), otro, r.deshacer, null)).rejects.toMatchObject({ status: 403 });
    // Alterado (otra carpeta de destino o firma cambiada): 400.
    const [cuerpo, firma] = r.deshacer.split('.');
    const c = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    c.i[0][1] = 'AAMkCARPETADEOTRO1';
    const alterado = `${Buffer.from(JSON.stringify(c)).toString('base64url')}.${firma}`;
    await expect(deshacerEliminar(deps(), yo, alterado, null)).rejects.toMatchObject({ status: 400, code: 'DESHACER_INVALIDO' });
    await expect(deshacerEliminar(deps(), yo, 'basura', null)).rejects.toMatchObject({ status: 400 });
    await expect(deshacerEliminar(deps(), yo, `${cuerpo}.${firma}x`, null)).rejects.toMatchObject({ status: 400 });
    // Firmado con otro secreto: 400.
    const ajeno = firmarComprobante(deps({ CORREO_MODO: 'mock' }, { secretoFirma: 'otro-secreto-de-servidor-123456' }), c);
    await expect(deshacerEliminar(deps(), yo, ajeno, null)).rejects.toMatchObject({ status: 400 });
    // Vencido: 410.
    reloj += 5 * 60_000 + 1;
    await expect(deshacerEliminar(deps(), yo, r.deshacer, null)).rejects.toMatchObject({ status: 410, code: 'DESHACER_VENCIDO' });
    expect(await papelera()).toEqual(['mock-msg-0003AAAA-ELIM']);
  });

  it('sin secreto de firma no elimina (no habría «Deshacer»): 503 y nada se mueve', async () => {
    await expect(eliminarMensajes(deps({ CORREO_MODO: 'mock' }, { secretoFirma: undefined }), yo, ['mock-msg-0003AAAA'], { confirmarVinculados: false }, null)).rejects.toMatchObject({ status: 503 });
    expect(await papelera()).toEqual([]);
    expect(() => leerComprobante(deps({ CORREO_MODO: 'mock' }, { secretoFirma: 'corto' }), yo, 'a.b')).toThrow(/Deshacer/);
  });

  it('interruptores: sin escritura (CORREO_ETIQUETAR_HABILITADO=false) o con CORREO_ELIMINAR_HABILITADO=false → 403', async () => {
    const apagados: Array<Record<string, string>> = [{ CORREO_MODO: 'mock', CORREO_ETIQUETAR_HABILITADO: 'false' }, { CORREO_MODO: 'mock', CORREO_ELIMINAR_HABILITADO: 'false' }];
    for (const env of apagados) {
      await expect(eliminarMensajes(deps(env), yo, ['mock-msg-0003AAAA'], { confirmarVinculados: false }, null)).rejects.toMatchObject({ status: 403 });
      await expect(deshacerEliminar(deps(env), yo, 'x.y', null)).rejects.toMatchObject({ status: 403 });
      expect(estadoConexion(deps(env), yo).eliminarHabilitado).toBe(false);
    }
    // El de envío no aplica: eliminar no envía nada.
    expect(estadoConexion(deps({ CORREO_MODO: 'mock', CORREO_ENVIO_HABILITADO: 'false' }), yo).eliminarHabilitado).toBe(true);
    expect(estadoConexion(deps(), yo).eliminarHabilitado).toBe(true);
  });

  it('límites: sin ids, más de 100 o ids inválidos → 400', async () => {
    await expect(eliminarMensajes(deps(), yo, [], { confirmarVinculados: false }, null)).rejects.toMatchObject({ status: 400 });
    await expect(eliminarMensajes(deps(), yo, Array.from({ length: 101 }, (_, i) => `AAMkX${String(i).padStart(5, '0')}`), { confirmarVinculados: false }, null)).rejects.toMatchObject({ status: 400 });
    await expect(eliminarMensajes(deps(), yo, ['../../users/otro'], { confirmarVinculados: false }, null)).rejects.toMatchObject({ status: 400 });
  });
});

describe('Correo · eliminar con Microsoft Graph (falso)', () => {
  /** Graph falso: un buzón con 2 correos en la Bandeja de entrada; `move` les da id nuevo. */
  function graph() {
    const carpetas: Record<string, string> = { AAMkPROPIO0001: 'FOLDERINBOX01', AAMkPROPIO0002: 'FOLDERCUSTOM1' };
    const lotes: Array<Array<{ id: string; method: string; url: string; body?: { destinationId?: string } }>> = [];
    const urls: string[] = [];
    let n = 0;
    const f = (async (url: string, init?: RequestInit) => {
      if (url.includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'APP', expires_in: 3600 }), { status: 200 });
      urls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === `${BASE}/mailFolders/deleteditems?$select=id`) return new Response(JSON.stringify({ id: 'FOLDERDELETED1' }), { status: 200 });
      if (url === 'https://graph.microsoft.com/v1.0/$batch') {
        const reqs = JSON.parse(String(init?.body)).requests as Array<{ id: string; method: string; url: string; body?: { destinationId?: string } }>;
        lotes.push(reqs);
        const responses = reqs.map((r) => {
          const id = decodeURIComponent(r.url.split('/messages/')[1].split(/[/?]/)[0]);
          if (!(id in carpetas)) return { id: r.id, status: 404, body: { error: { code: 'ErrorItemNotFound' } } };
          if (r.method === 'GET') return { id: r.id, status: 200, body: { id, parentFolderId: carpetas[id], conversationId: `CONV-${id}`, internetMessageId: `<${id}@x>`, isRead: true } };
          const destino = r.body?.destinationId === 'deleteditems' ? 'FOLDERDELETED1' : String(r.body?.destinationId);
          const nuevo = `AAMkMOVIDO${String(++n).padStart(4, '0')}`;
          delete carpetas[id];
          carpetas[nuevo] = destino;
          return { id: r.id, status: 201, body: { id: nuevo, parentFolderId: destino } };
        });
        return new Response(JSON.stringify({ responses }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    return { f, carpetas, lotes, urls };
  }

  it('consulta cada id en /users/{buzón de la sesión}, mueve con `move` a deleteditems y «Deshacer» vuelve a la carpeta de origen', async () => {
    const g = graph();
    const d = deps(graphEnv, { fetchFn: g.f });
    const r = await eliminarMensajes(d, yo, ['AAMkPROPIO0001', 'AAMkPROPIO0002', 'AAMkDEGERENCIA1'], { confirmarVinculados: false }, null);
    if (r.requiereConfirmacion) throw new Error('no');
    expect(r.eliminados).toEqual([
      { id: 'AAMkPROPIO0001', nuevoId: 'AAMkMOVIDO0001' },
      { id: 'AAMkPROPIO0002', nuevoId: 'AAMkMOVIDO0002' },
    ]);
    expect(r.fallidos).toEqual(['AAMkDEGERENCIA1']);
    // 1.er lote: GET de pertenencia; 2.º: move SOLO de los propios, a deleteditems.
    expect(g.lotes[0].every((q) => q.method === 'GET' && q.url.startsWith('/users/laura%40gsslatam.com/messages/'))).toBe(true);
    expect(g.lotes[1]).toEqual([
      expect.objectContaining({ method: 'POST', url: '/users/laura%40gsslatam.com/messages/AAMkPROPIO0001/move', body: { destinationId: 'deleteditems' } }),
      expect.objectContaining({ method: 'POST', url: '/users/laura%40gsslatam.com/messages/AAMkPROPIO0002/move', body: { destinationId: 'deleteditems' } }),
    ]);
    expect(g.carpetas).toEqual({ AAMkMOVIDO0001: 'FOLDERDELETED1', AAMkMOVIDO0002: 'FOLDERDELETED1' });

    const u = await deshacerEliminar(d, yo, r.deshacer, null);
    expect(u.restaurados).toEqual([
      { id: 'AAMkMOVIDO0001', nuevoId: 'AAMkMOVIDO0003' },
      { id: 'AAMkMOVIDO0002', nuevoId: 'AAMkMOVIDO0004' },
    ]);
    // Cada uno a SU carpeta de origen (la que leyó el servidor al eliminar).
    expect(g.carpetas).toEqual({ AAMkMOVIDO0003: 'FOLDERINBOX01', AAMkMOVIDO0004: 'FOLDERCUSTOM1' });
    const todo = JSON.stringify(g.lotes) + g.urls.join('\n');
    expect(todo).not.toContain('gerencia');
    // Nunca un borrado: ni DELETE ni permanentDelete.
    expect(todo).not.toMatch(/DELETE|permanentDelete/);
    expect(g.urls.every((x) => x.includes(`${BASE}/`) || x.endsWith('/v1.0/$batch'))).toBe(true);
  });

  it('ids de otro buzón únicamente: 404 sin ningún `move`', async () => {
    const g = graph();
    await expect(eliminarMensajes(deps(graphEnv, { fetchFn: g.f }), yo, ['AAMkDEGERENCIA1'], { confirmarVinculados: false }, null)).rejects.toMatchObject({ status: 404 });
    expect(g.lotes.flat().some((q) => q.method === 'POST')).toBe(false);
  });
});
