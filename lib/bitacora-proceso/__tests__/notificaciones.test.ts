import { beforeEach, describe, expect, it, vi } from 'vitest';

// Avisos de la Bitácora de Proceso al JEFE DE PRODUCCIÓN (rol interno «inspector») (campana + push), sobre el notificador compartido. Sin correos.

const { createAndSendNotifications } = vi.hoisted(() => ({ createAndSendNotifications: vi.fn() }));
vi.mock('../../notifications.js', () => ({ createAndSendNotifications }));

import { avisoInspectorAsignado, avisoPorVerificar, bitacoraUrl, OT_NOTIF_TITULOS, otNotifier, type AvisoInspector } from '../notificaciones';

const aviso: AvisoInspector = {
  idOrden: 42,
  idCompany: 1,
  consecutivo: 7,
  producto: 'Cefazolina 1 g',
  lote: '1565426',
  inspectorEmail: 'Inspector@Farmalogica.com ',
  actorNombre: 'Supervisor Planta',
  actorEmail: 'sup@farmalogica.com',
};

beforeEach(() => createAndSendNotifications.mockReset());

describe('Bitácora de Proceso · avisos al jefe de producción', () => {
  it('enlace directo a la bitácora con la empresa', () => {
    expect(bitacoraUrl(42, 1)).toBe('/process/bitacora-proceso/42?empresa=1');
  });

  it('al cerrar: «por verificar» al jefe de producción, con enlace, lote y producto', () => {
    const [n] = avisoPorVerificar(aviso);
    expect(n.emails).toEqual(['inspector@farmalogica.com']);
    expect(n.payload.title).toBe(OT_NOTIF_TITULOS.porVerificar);
    expect(n.payload.url).toBe('/process/bitacora-proceso/42?empresa=1');
    expect(n.payload.body).toContain('Supervisor Planta cerró la bitácora N.º 7 (Cefazolina 1 g, lote 1565426) («Cerró»)');
    expect(n.payload.body).not.toMatch(/firm|inspector/i);
    expect(n.payload.body).toContain('«Verificó»');
    // Sin «#número»: la campana no la confunde con un ticket.
    expect(n.payload.body).not.toContain('#');
    expect(n.payload.tag).toBe('ot-42-verificar');
  });

  it('al abrir: aviso de designación al jefe de producción', () => {
    const [n] = avisoInspectorAsignado(aviso);
    expect(n.emails).toEqual(['inspector@farmalogica.com']);
    expect(n.payload.title).toBe(OT_NOTIF_TITULOS.inspectorAsignado);
    expect(n.payload.body).toContain('lo designó jefe de producción');
    expect(n.payload.title).toBe('Fue designado jefe de producción de una bitácora · SynerLink');
    expect(`${n.payload.title} ${n.payload.body}`).not.toMatch(/inspector|firm/i);
    expect(n.payload.tag).toBe('ot-42-inspector');
  });

  it('sin inspector activo, o si el inspector es quien hizo la acción: no se notifica', () => {
    expect(avisoPorVerificar({ ...aviso, inspectorEmail: null })).toEqual([]);
    expect(avisoInspectorAsignado({ ...aviso, inspectorEmail: '  ' })).toEqual([]);
    expect(avisoPorVerificar({ ...aviso, inspectorEmail: 'SUP@farmalogica.com' })).toEqual([]);
  });

  it('otNotifier usa el notificador compartido (campana + push) y nunca lanza', async () => {
    createAndSendNotifications.mockResolvedValue({ saved: 1, pushed: 1 });
    await otNotifier(avisoPorVerificar(aviso));
    expect(createAndSendNotifications).toHaveBeenCalledTimes(1);
    expect(createAndSendNotifications).toHaveBeenCalledWith(['inspector@farmalogica.com'], expect.objectContaining({ url: '/process/bitacora-proceso/42?empresa=1' }));
    // Solo dos argumentos: sin opción de omitir la campana.
    expect(createAndSendNotifications.mock.calls[0]).toHaveLength(2);

    createAndSendNotifications.mockRejectedValueOnce(new Error('push caído'));
    await expect(otNotifier(avisoPorVerificar(aviso))).resolves.toBeUndefined();

    createAndSendNotifications.mockReset();
    await otNotifier([]);
    await otNotifier([{ emails: [], payload: { title: 't', body: 'b', url: '/' } }]);
    expect(createAndSendNotifications).not.toHaveBeenCalled();
  });
});
