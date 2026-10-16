import { beforeEach, describe, expect, it, vi } from 'vitest';

// Avisos de la Bitácora de Proceso al INSPECTOR y al JEFE DE PRODUCCIÓN (campana + push), sobre el notificador compartido. Sin correos.

const { createAndSendNotifications } = vi.hoisted(() => ({ createAndSendNotifications: vi.fn() }));
vi.mock('../../notifications.js', () => ({ createAndSendNotifications }));

import { avisosApertura, avisoSiguienteVistoBueno, bitacoraUrl, OT_NOTIF_TITULOS, otNotifier, type AvisoBitacora } from '../notificaciones';

const aviso: AvisoBitacora = {
  idOrden: 42,
  idCompany: 1,
  consecutivo: 7,
  producto: 'Cefazolina 1 g',
  lote: '1565426',
  inspectorEmail: 'Inspector@Farmalogica.com ',
  jefeEmail: 'jefe@farmalogica.com',
  actorNombre: 'Supervisor Planta',
  actorEmail: 'sup@farmalogica.com',
};

beforeEach(() => createAndSendNotifications.mockReset());

describe('Bitácora de Proceso · avisos al inspector y al jefe de producción', () => {
  it('enlace directo a la bitácora con la empresa', () => {
    expect(bitacoraUrl(42, 1)).toBe('/process/bitacora-proceso/42?empresa=1');
  });

  it('al abrir: aviso de designación al inspector y al jefe, cada uno con su rol', () => {
    const [i, j] = avisosApertura(aviso);
    expect(i.emails).toEqual(['inspector@farmalogica.com']);
    expect(i.payload.title).toBe(OT_NOTIF_TITULOS.inspectorAsignado);
    expect(i.payload.body).toContain('lo designó inspector');
    expect(i.payload.tag).toBe('ot-42-inspector');
    expect(j.emails).toEqual(['jefe@farmalogica.com']);
    expect(j.payload.title).toBe(OT_NOTIF_TITULOS.jefeAsignado);
    expect(j.payload.body).toContain('lo designó jefe de producción');
    expect(`${i.payload.body} ${j.payload.body}`).not.toMatch(/firm|contraseña|#/i);
  });

  it('tras el cierre se avisa al inspector; tras el inspector, al jefe; sin inspector, el cierre avisa al jefe', () => {
    const [n] = avisoSiguienteVistoBueno(aviso, 'SUPERVISOR', 'INSPECTOR');
    expect(n.emails).toEqual(['inspector@farmalogica.com']);
    expect(n.payload.title).toBe(OT_NOTIF_TITULOS.porVistoBueno);
    expect(n.payload.body).toContain('Supervisor Planta cerró la bitácora N.º 7 (Cefazolina 1 g, lote 1565426) («Cerró»)');
    expect(n.payload.body).toContain('como inspector');
    expect(n.payload.url).toBe('/process/bitacora-proceso/42?empresa=1');
    expect(n.payload.tag).toBe('ot-42-inspector');
    const [m] = avisoSiguienteVistoBueno({ ...aviso, actorNombre: 'Insp', actorEmail: 'inspector@farmalogica.com' }, 'INSPECTOR', 'JEFE_PROD');
    expect(m.emails).toEqual(['jefe@farmalogica.com']);
    expect(m.payload.body).toContain('dio su visto bueno como inspector');
    expect(m.payload.tag).toBe('ot-42-jefe_prod');
    expect(avisoSiguienteVistoBueno(aviso, 'SUPERVISOR', 'JEFE_PROD')[0].emails).toEqual(['jefe@farmalogica.com']);
  });

  it('nada que avisar: siguiente operario/supervisor/ninguno, sin correo activo, o es quien hizo la acción', () => {
    expect(avisoSiguienteVistoBueno(aviso, 'OPERARIO', 'SUPERVISOR')).toEqual([]);
    expect(avisoSiguienteVistoBueno(aviso, 'JEFE_PROD', null)).toEqual([]);
    expect(avisoSiguienteVistoBueno({ ...aviso, inspectorEmail: null }, 'SUPERVISOR', 'INSPECTOR')).toEqual([]);
    expect(avisosApertura({ ...aviso, inspectorEmail: '  ', jefeEmail: 'SUP@farmalogica.com' })).toEqual([]);
  });

  it('otNotifier usa el notificador compartido (campana + push) y nunca lanza', async () => {
    createAndSendNotifications.mockResolvedValue({ saved: 1, pushed: 1 });
    await otNotifier(avisoSiguienteVistoBueno(aviso, 'SUPERVISOR', 'INSPECTOR'));
    expect(createAndSendNotifications).toHaveBeenCalledTimes(1);
    expect(createAndSendNotifications).toHaveBeenCalledWith(['inspector@farmalogica.com'], expect.objectContaining({ url: '/process/bitacora-proceso/42?empresa=1' }));
    expect(createAndSendNotifications.mock.calls[0]).toHaveLength(2);

    createAndSendNotifications.mockRejectedValueOnce(new Error('push caído'));
    await expect(otNotifier(avisosApertura(aviso))).resolves.toBeUndefined();

    createAndSendNotifications.mockReset();
    await otNotifier([]);
    await otNotifier([{ emails: [], payload: { title: 't', body: 'b', url: '/' } }]);
    expect(createAndSendNotifications).not.toHaveBeenCalled();
  });
});
