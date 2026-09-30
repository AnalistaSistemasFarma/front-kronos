import { describe, expect, it } from 'vitest';
import {
  JUSTIFICACION_MAX,
  JUSTIFICACION_MIN,
  MSG_DOCUMENTO_FIRMADO,
  esEstadoFinalOrion,
  motivoFaltaPermisoEliminar,
  puedeEliminarDocumento,
  validarJustificacionEliminacion,
} from '../deletePolicy';

const conAmbasLlaves = { esAdmin: true, tienePermisoEliminarAdjuntos: true };

describe('puedeEliminarDocumento — doble llave', () => {
  it('sin ser administrador → 403 aunque tenga el permiso', () => {
    const r = puedeEliminarDocumento({ status: 'BORRADOR', esAdmin: false, tienePermisoEliminarAdjuntos: true });
    expect(r.permitido).toBe(false);
    expect(r.httpStatus).toBe(403);
    expect(r.motivo).toMatch(/administradores/);
  });

  it('administrador sin “Eliminar adjuntos” → 403 indicando el permiso que falta', () => {
    const r = puedeEliminarDocumento({ status: 'BORRADOR', esAdmin: true, tienePermisoEliminarAdjuntos: false });
    expect(r.permitido).toBe(false);
    expect(r.httpStatus).toBe(403);
    expect(r.motivo).toMatch(/Eliminar adjuntos/);
  });

  it('sin ninguna de las dos → 403 que menciona ambas', () => {
    const motivo = motivoFaltaPermisoEliminar(false, false);
    expect(motivo).toMatch(/administrador/);
    expect(motivo).toMatch(/Eliminar adjuntos/);
  });

  it('el permiso se revisa antes que el estado (no filtra si está firmado)', () => {
    const r = puedeEliminarDocumento({ status: 'FIRMADO', esAdmin: false, tienePermisoEliminarAdjuntos: false });
    expect(r.httpStatus).toBe(403);
  });
});

describe('puedeEliminarDocumento — por estado', () => {
  it.each(['FIRMADO', 'SIGNED', 'COMPLETED', 'firmado'])('%s → 409, no se puede eliminar', (status) => {
    const r = puedeEliminarDocumento({ status, ...conAmbasLlaves, tieneDocumentoOrion: true });
    expect(r).toEqual({
      permitido: false,
      motivo: MSG_DOCUMENTO_FIRMADO,
      httpStatus: 409,
      requiereDetenerOrion: false,
    });
  });

  it.each(['PENDIENTE_FIRMA', 'EN_PROCESO'])('%s con documento en Orion → exige detenerlo primero', (status) => {
    const r = puedeEliminarDocumento({ status, ...conAmbasLlaves, tieneDocumentoOrion: true });
    expect(r.permitido).toBe(true);
    expect(r.requiereDetenerOrion).toBe(true);
  });

  it('flujo activo sin documento en Orion → se permite sin detener (no hay nada allá)', () => {
    const r = puedeEliminarDocumento({ status: 'EN_PROCESO', ...conAmbasLlaves, tieneDocumentoOrion: false });
    expect(r.permitido).toBe(true);
    expect(r.requiereDetenerOrion).toBe(false);
  });

  it.each(['BORRADOR', '', null, 'DEVUELTO', 'RECHAZADO'])('%s → se puede eliminar sin detener', (status) => {
    const r = puedeEliminarDocumento({ status, ...conAmbasLlaves, tieneDocumentoOrion: true });
    expect(r.permitido).toBe(true);
    expect(r.requiereDetenerOrion).toBe(false);
  });

  it('esEstadoFinalOrion', () => {
    expect(esEstadoFinalOrion('firmado')).toBe(true);
    expect(esEstadoFinalOrion('EN_PROCESO')).toBe(false);
    expect(esEstadoFinalOrion(undefined)).toBe(false);
  });
});

describe('validarJustificacionEliminacion', () => {
  it('rechaza vacía, solo espacios o no texto', () => {
    expect(validarJustificacionEliminacion('').ok).toBe(false);
    expect(validarJustificacionEliminacion('    ').ok).toBe(false);
    expect(validarJustificacionEliminacion(undefined).ok).toBe(false);
    expect(validarJustificacionEliminacion(123).ok).toBe(false);
  });

  it(`rechaza menos de ${JUSTIFICACION_MIN} caracteres (sin contar espacios de los extremos)`, () => {
    const r = validarJustificacionEliminacion('   corto    ');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/al menos/);
  });

  it(`rechaza más de ${JUSTIFICACION_MAX} caracteres`, () => {
    const r = validarJustificacionEliminacion('a'.repeat(JUSTIFICACION_MAX + 1));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/superar/);
  });

  it('acepta y recorta una justificación válida', () => {
    const r = validarJustificacionEliminacion('  Se cargó la versión equivocada.  ');
    expect(r).toEqual({ ok: true, valor: 'Se cargó la versión equivocada.', error: null });
    expect(validarJustificacionEliminacion('a'.repeat(JUSTIFICACION_MIN)).ok).toBe(true);
    expect(validarJustificacionEliminacion('a'.repeat(JUSTIFICACION_MAX)).ok).toBe(true);
  });
});
