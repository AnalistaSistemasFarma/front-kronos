import { describe, expect, it } from 'vitest';
import { notificationKind } from '../notificationKind';

const VIEW = '/process/request-general/view-request?id=10&from=general-requests';
const VIEW_FIRMA = `${VIEW}&orionFileId=abc`;
const BOARD = '/process/request-general/draft-board?requestId=10&fileId=abc';

describe('tipo de notificación (firma / validación)', () => {
  it.each([
    ['Documento para validar: Contrato.docx', BOARD],
    ['Nueva versión para validar: Contrato.docx', BOARD],
    ['Validado internamente: Contrato.docx', VIEW],
    ['Aprobado para firma: Contrato.pdf', VIEW],
    ['Devuelto para corrección: Contrato.pdf', VIEW],
    ['Le toca corregir: Contrato.docx', BOARD],
    ['Ana Pérez respondió la marca 3: Contrato.docx', BOARD],
    ['El cliente rechazó el borrador: Contrato.docx', VIEW],
    ['Aprobado por el cliente: Contrato.docx', VIEW],
  ])('validación: «%s»', (title, path) => {
    expect(notificationKind(title, path)).toEqual({ kind: 'validacion', label: 'Validación', color: 'teal' });
  });

  it.each([
    ['Le toca firmar: Contrato.pdf', '/process/authorization?from=authorization'],
    ['Incluido como firmante · Contrato.pdf', VIEW_FIRMA],
    ['Documento enviado a firma · SynerLink', VIEW_FIRMA],
    ['Firma avanzada · SynerLink', VIEW_FIRMA],
    ['Documento firmado por completo · SynerLink', VIEW],
    ['Documento devuelto · SynerLink', VIEW_FIRMA],
    ['Documento rechazado · SynerLink', VIEW_FIRMA],
  ])('firma: «%s»', (title, path) => {
    expect(notificationKind(title, path)).toEqual({ kind: 'firma', label: 'Firma', color: 'violet' });
  });

  it('las demás conservan su tipo y no llevan etiqueta', () => {
    expect(notificationKind('Nuevo ticket · Mesa de ayuda', '/process/help-desk/view-ticket?id=1').kind).toBe('ticket');
    expect(notificationKind('Actividad asignada · SynerLink', '/process/request-general/view-activities').kind).toBe('actividad');
    const general = notificationKind('Nueva solicitud · SynerLink', VIEW);
    expect(general).toEqual({ kind: 'general', label: null, color: 'blue' });
  });

  it('sin título ni enlace es general', () => {
    expect(notificationKind(null, null).kind).toBe('general');
  });
});
