import { describe, expect, it } from 'vitest';
import { isAssignedTo, isRequesterSelfAssigned, requestAssigneeId } from './assignee';

describe('asignado de la solicitud (#838, cierre desde el enlace directo)', () => {
  it('desde la lista (sessionStorage): usa id_assigned_process_category', () => {
    const fila = { id_requester: 'u1', id_assigned_process_category: 'u1' };
    expect(requestAssigneeId(fila)).toBe('u1');
    expect(isRequesterSelfAssigned(fila)).toBe(true);
  });

  it('desde el enlace del correo (solo la API del detalle, versión anterior): usa IDassignedUserID', () => {
    const api = { id_requester: 'u1', IDassignedUserID: 'u1' };
    expect(requestAssigneeId(api)).toBe('u1');
    expect(isRequesterSelfAssigned(api)).toBe(true);
  });

  it('el asignado de la categoría sirve de respaldo', () => {
    expect(requestAssigneeId({ id_assigned_category: 7 })).toBe('7');
  });

  it('si el asignado es otra persona, el solicitante NO puede cerrar', () => {
    expect(isRequesterSelfAssigned({ id_requester: 'u1', IDassignedUserID: 'u2' })).toBe(false);
    expect(isRequesterSelfAssigned({ id_requester: 'u1', id_assigned_process_category: 'u2', IDassignedUserID: 'u1' })).toBe(false);
  });

  it('sin datos no habilita nada', () => {
    expect(isRequesterSelfAssigned(null)).toBe(false);
    expect(isRequesterSelfAssigned({ id_requester: 'u1' })).toBe(false);
    expect(isRequesterSelfAssigned({ IDassignedUserID: 'u1' })).toBe(false);
    expect(isRequesterSelfAssigned({ id_requester: ' ', IDassignedUserID: ' ' })).toBe(false);
  });

  it('isAssignedTo compara con el usuario de la sesión (botón «Ver Tareas»)', () => {
    expect(isAssignedTo({ IDassignedUserID: 'u9' }, 'u9')).toBe(true);
    expect(isAssignedTo({ IDassignedUserID: 'u9' }, 'u1')).toBe(false);
    expect(isAssignedTo({}, '')).toBe(false);
  });
});
