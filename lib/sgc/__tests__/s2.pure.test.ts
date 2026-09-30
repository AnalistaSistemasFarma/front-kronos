import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAndSendNotifications } = vi.hoisted(() => ({ createAndSendNotifications: vi.fn() }));
vi.mock('../../notifications.js', () => ({ createAndSendNotifications }));

import { authorizationReaches, authorizationStatusFor, getAuthorizationTypeCodeError, sgcAuthorizationColor, SGC_AUTHORIZATION_STATUS_LABELS } from '../authorizations';
import { suggestResponsibles, type SgcMatrixEntry } from '../flows/matrix';
import { noopNotifier, recipients, requestUrl, sgcNotifier, SGC_NOTIFICATION_TITLES, taskUrl } from '../notifications';
import { describeSignaturePoint, signaturePointFor, SGC_SIGNATURE_NOTICE, SGC_SIGNATURE_STATUS_LABELS } from '../signature/signaturePoint';

describe('SGC · matriz de responsables (solo sugiere)', () => {
  const e = (id: number, role: SgcMatrixEntry['role'], idProcess: number | null, idDocumentType: number | null, who: { userEmail?: string; cargoName?: string }, extra: Partial<SgcMatrixEntry> = {}): SgcMatrixEntry => ({
    id,
    role,
    idProcess,
    idDocumentType,
    userEmail: who.userEmail ?? null,
    cargoName: who.cargoName ?? null,
    sortOrder: 0,
    isActive: true,
    isExample: false,
    ...extra,
  });
  const entries = [
    e(1, 'revisor', null, null, { cargoName: 'Jefe del área' }, { isExample: true }),
    e(2, 'revisor', 10, 20, { userEmail: 'Ana@x.co' }, { sortOrder: 2 }),
    e(3, 'revisor', 10, 20, { userEmail: 'luis@x.co' }, { sortOrder: 1 }),
    e(4, 'revisor', 10, null, { userEmail: 'solo-proceso@x.co' }),
    e(5, 'aprobador', null, 20, { cargoName: 'Director Técnico' }),
    e(6, 'aprobador', null, 20, { userEmail: 'inactivo@x.co' }, { isActive: false }),
    e(7, 'elaborador', 99, null, { userEmail: 'otro-proceso@x.co' }),
  ];

  it('[SGC-REQ-034] gana la fila más específica (proceso y tipo > proceso > tipo > general), en su orden, sin inactivas', () => {
    const s = suggestResponsibles(entries, { idProcess: 10, idDocumentType: 20 });
    expect(s.find((x) => x.role === 'revisor')).toEqual({ role: 'revisor', specificity: 3, people: ['luis@x.co', 'ana@x.co'], cargos: [], fromExample: false });
    expect(s.find((x) => x.role === 'aprobador')).toMatchObject({ specificity: 1, people: [], cargos: ['Director Técnico'] });
    expect(s.find((x) => x.role === 'elaborador')).toMatchObject({ specificity: -1, people: [], cargos: [] });
  });

  it('[SGC-REQ-034] sin filas específicas cae a la general y marca si viene de datos de ejemplo', () => {
    const s = suggestResponsibles(entries, { idProcess: 11, idDocumentType: 21 });
    expect(s.find((x) => x.role === 'revisor')).toMatchObject({ specificity: 0, cargos: ['Jefe del área'], fromExample: true });
    expect(suggestResponsibles(entries, { idProcess: 10, idDocumentType: null }).find((x) => x.role === 'revisor')?.people).toEqual(['solo-proceso@x.co']);
  });
});

describe('SGC · Autorizaciones SGC (copia congelada del mecanismo de SynerLink)', () => {
  it('[SGC-REQ-033] una autorización directa llega solo a su asignado; una de grupo, a quien esté en el grupo del tipo', () => {
    expect(authorizationReaches({ assignedEmail: 'Ana@x.co', typeCode: 'SGC-APROBACION', status: 'pendiente' }, 'ana@x.co ', [])).toBe(true);
    expect(authorizationReaches({ assignedEmail: 'ana@x.co', typeCode: 'SGC-APROBACION', status: 'pendiente' }, 'luis@x.co', ['SGC-APROBACION'])).toBe(false);
    expect(authorizationReaches({ assignedEmail: null, typeCode: 'SGC-VERIF-CALIDAD', status: 'pendiente' }, 'cal@x.co', ['SGC-VERIF-CALIDAD'])).toBe(true);
    expect(authorizationReaches({ assignedEmail: null, typeCode: 'SGC-VERIF-CALIDAD', status: 'pendiente' }, 'cal@x.co', [])).toBe(false);
  });

  it('[SGC-REQ-033] estados, colores y códigos de tipo', () => {
    expect(authorizationStatusFor('aprobar')).toBe('autorizada');
    expect(authorizationStatusFor('devolver')).toBe('rechazada');
    expect(['pendiente', 'autorizada', 'rechazada', 'anulada'].map(sgcAuthorizationColor)).toEqual(['yellow', 'green', 'red', 'gray']);
    expect(SGC_AUTHORIZATION_STATUS_LABELS.anulada).toBe('Anulada');
    expect(getAuthorizationTypeCodeError('SGC-APROBACION')).toBeNull();
    expect(getAuthorizationTypeCodeError('sgc')).toMatch(/mayúsculas/);
  });
});

describe('SGC · punto de firma (preparado en el S2, cumplido con la firma propia del S3)', () => {
  it('[SGC-REQ-036][SGC-REQ-038] cada paso con firma deja su significado pendiente hasta la firma electrónica propia', () => {
    expect(signaturePointFor('reviso')).toEqual({ signatureStatus: 'pendiente', signatureMeaning: 'reviso' });
    expect(signaturePointFor(null)).toEqual({ signatureStatus: 'no_aplica', signatureMeaning: null });
    expect(describeSignaturePoint('aprobo', 'pendiente')).toBe('Aprobó (firma pendiente)');
    expect(describeSignaturePoint('elaboro', 'firmada')).toBe('Elaboró (firmado electrónicamente)');
    expect(describeSignaturePoint('otro', 'firmada')).toBe('otro (firmado electrónicamente)');
    expect(describeSignaturePoint('reviso', 'sin_firma_s2')).toBe('Revisó (decidido en el Sprint 2, sin firma electrónica)');
    expect(describeSignaturePoint(null, 'pendiente')).toBeNull();
    expect(describeSignaturePoint('reviso', 'no_aplica')).toBeNull();
    expect(SGC_SIGNATURE_NOTICE).toMatch(/contraseña de SynerLink/);
    expect(SGC_SIGNATURE_STATUS_LABELS.sin_firma_s2).toMatch(/Sprint 2/);
  });
});

describe('SGC · notificaciones (mismo patrón que SynerLink)', () => {
  beforeEach(() => createAndSendNotifications.mockReset());

  it('[SGC-REQ-035] destinatarios sin vacíos ni repetidos y nunca quien hizo la acción; enlaces propios del módulo', () => {
    expect(recipients(['A@x.co', 'a@x.co', null, '', ' b@x.co '], 'B@X.CO')).toEqual(['a@x.co']);
    expect(recipients(['a@x.co'])).toEqual(['a@x.co']);
    expect(taskUrl(7)).toBe('/process/sgc-documental/tareas/7');
    expect(requestUrl(3)).toBe('/process/sgc-documental/solicitudes/3');
    expect(SGC_NOTIFICATION_TITLES.tareaAsignada).toMatch(/· SynerLink$/);
  });

  it('[SGC-REQ-035] el notificador real guarda en la campana y envía push con la utilidad compartida; un fallo no rompe la acción', async () => {
    createAndSendNotifications.mockResolvedValueOnce({ saved: 1 }).mockRejectedValueOnce(new Error('push caído'));
    const payload = { title: 't', body: 'b', url: '/x' };
    await sgcNotifier([{ emails: ['a@x.co'], payload }, { emails: ['b@x.co'], payload }, { emails: [], payload }]);
    expect(createAndSendNotifications).toHaveBeenCalledTimes(2);
    expect(createAndSendNotifications).toHaveBeenCalledWith(['a@x.co'], payload);
    await sgcNotifier([]);
    await noopNotifier([{ emails: ['a@x.co'], payload }]);
    expect(createAndSendNotifications).toHaveBeenCalledTimes(2);
  });
});
