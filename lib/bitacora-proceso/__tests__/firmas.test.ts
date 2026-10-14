import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OT_CATALOGO_FARMALOGICA, OT_PICTOGRAMAS, otPictograma } from '../constants';
import {
  assertInspectorDistinto,
  assertNoBloqueado,
  assertPuedeCerrar,
  assertPuedeVerificar,
  huellaContenido,
  LimiteReautenticacion,
  OT_CONFIRMACION_TEXTO,
  OT_CONFIRMACION_VERSION,
  OT_FIRMA_SIGNIFICADO,
  parseConfirmacion,
  type ContenidoFirmable,
} from '../firmas';
import { isOtError, OtError } from '../rules';

const sup = { idCompany: 1, companyName: 'FARMALOGICA S.A.', canOperate: true, canManage: true };
const op = { ...sup, canManage: false };

function errorOf(fn: () => unknown): OtError {
  try {
    fn();
  } catch (e) {
    if (isOtError(e)) return e;
    throw e;
  }
  throw new Error('no lanzó');
}

const base: ContenidoFirmable = {
  idOrden: 7, idCompany: 1, consecutivo: 3, producto: 'Cefazolina', itemCode: 'PTCZ0121', lote: 'L1', turno: 'MANANA', area: null,
  sapOpDocNum: 14045, supervisor: 'sup', inspector: 'insp', abiertaEn: '2026-10-13T20:00:00.000Z', auxiliares: ['b', 'a'],
  registros: [{ id: '1', actividad: 'Alimentación Tapón', usuario: 'a', registradoEn: '2026-10-13T20:05:00.000Z', observacion: null }],
  observacionCierre: null,
};

describe('Bitácora de Proceso · confirmación «Cerró» / «Verificó» (reglas, A4)', () => {
  it('es un check propio de la bitácora: sin consentimiento de GSS Firma ni Ley 527', () => {
    expect(OT_CONFIRMACION_VERSION).toBe('bitacora-check-2026-10-14');
    expect(OT_FIRMA_SIGNIFICADO).toEqual({ SUPERVISOR: 'Cerró', INSPECTOR: 'Verificó' });
    expect(JSON.stringify(OT_CONFIRMACION_TEXTO)).not.toMatch(/527|firma electr/i);
  });

  it('exige elegir la persona, marcar la casilla y escribir la contraseña', () => {
    const ok = { firmante: ' u1 ', confirmo: true, password: 's3creta' };
    expect(errorOf(() => parseConfirmacion(null)).status).toBe(400);
    expect(errorOf(() => parseConfirmacion({ ...ok, firmante: '' })).message).toMatch(/Elija su nombre/);
    expect(errorOf(() => parseConfirmacion({ ...ok, firmante: 'x'.repeat(51) })).status).toBe(400);
    expect(errorOf(() => parseConfirmacion({ ...ok, confirmo: 'true' })).message).toMatch(/casilla/);
    expect(errorOf(() => parseConfirmacion({ ...ok, password: '' })).message).toMatch(/contraseña/);
    expect(errorOf(() => parseConfirmacion({ ...ok, password: 'x'.repeat(201) })).status).toBe(400);
    expect(parseConfirmacion(ok)).toEqual({ idFirmante: 'u1', password: 's3creta' });
  });

  it('segregación: el jefe de producción no es el supervisor que abre ni quien cierra', () => {
    expect(errorOf(() => assertInspectorDistinto('u1', 'u1')).status).toBe(400);
    expect(() => assertInspectorDistinto('u2', 'u1')).not.toThrow();
    expect(errorOf(() => assertPuedeCerrar({ estado: 'ABIERTA', inspector: 'u1' }, 'u1', sup)).status).toBe(403);
  });

  it('cierre: quien confirma debe tener Gestión (su acceso, no el de la sesión) y la bitácora estar abierta', () => {
    expect(errorOf(() => assertPuedeCerrar({ estado: 'ABIERTA', inspector: 'i' }, 'u1', op)).status).toBe(403);
    expect(errorOf(() => assertPuedeCerrar({ estado: 'ABIERTA', inspector: 'i' }, 'u1', null)).message).toMatch(/supervisor/);
    expect(errorOf(() => assertPuedeCerrar({ estado: 'CERRADA', inspector: 'i' }, 'u1', sup)).status).toBe(409);
    expect(() => assertPuedeCerrar({ estado: 'ABIERTA', inspector: 'i' }, 'u1', sup)).not.toThrow();
    expect(() => assertPuedeCerrar({ estado: 'ABIERTA', inspector: null }, 'u1', sup)).not.toThrow();
  });

  it('verificación: solo el jefe de producción designado, después del cierre y una sola vez', () => {
    const cerrada = { estado: 'CERRADA', inspector: 'i' };
    const firmaSup = [{ rol: 'SUPERVISOR', id_user: 's' }];
    expect(errorOf(() => assertPuedeVerificar(cerrada, firmaSup, 'otro')).status).toBe(403);
    expect(errorOf(() => assertPuedeVerificar({ estado: 'ABIERTA', inspector: 'i' }, [], 'i')).status).toBe(409);
    expect(errorOf(() => assertPuedeVerificar(cerrada, [], 'i')).message).toMatch(/supervisor/);
    expect(errorOf(() => assertPuedeVerificar(cerrada, [{ rol: 'SUPERVISOR', id_user: 'i' }], 'i')).status).toBe(403);
    expect(errorOf(() => assertPuedeVerificar(cerrada, [...firmaSup, { rol: 'INSPECTOR', id_user: 'i' }], 'i')).status).toBe(409);
    expect(errorOf(() => assertPuedeVerificar({ estado: 'CERRADA', inspector: null }, firmaSup, 'i')).status).toBe(403);
    expect(() => assertPuedeVerificar(cerrada, firmaSup, 'i')).not.toThrow();
  });

  it('la huella SHA-256 es estable (no depende del orden de auxiliares ni operarios) y cambia si cambia el contenido', () => {
    const h = huellaContenido(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaContenido({ ...base, auxiliares: ['a', 'b'] })).toBe(h);
    const conOps = huellaContenido({ ...base, operadores: [8, 7] });
    expect(huellaContenido({ ...base, operadores: [7, 8] })).toBe(conOps);
    expect(conOps).not.toBe(h);
    expect(huellaContenido({ ...base, registros: [{ ...base.registros[0], operador: 7 }] })).not.toBe(h);
    expect(huellaContenido({ ...base, registros: [{ ...base.registros[0], observacion: 'x' }] })).not.toBe(h);
    expect(huellaContenido({ ...base, lote: 'L2' })).not.toBe(h);
    expect(huellaContenido({ ...base, firmaSupervisorSha256: 'abc' })).not.toBe(h);
  });

  it('bloquea la confirmación tras 5 contraseñas incorrectas en 15 minutos (y se libera después)', () => {
    const lim = new LimiteReautenticacion(5, 15 * 60_000);
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) lim.registrarFallo('Sup@F.com', t0);
    expect(() => assertNoBloqueado(lim, 'sup@f.com', t0)).not.toThrow();
    lim.registrarFallo('sup@f.com', t0);
    expect(errorOf(() => assertNoBloqueado(lim, 'sup@f.com', t0 + 1000)).status).toBe(429);
    expect(lim.bloqueado('sup@f.com', t0 + 16 * 60_000)).toBe(false);
    lim.registrarFallo('x@f.com', t0);
    lim.limpiar('x@f.com');
    expect(lim.bloqueado('x@f.com', t0)).toBe(false);
  });
});

describe('Bitácora de Proceso · pictogramas de la especificación', () => {
  it('las 3 alimentaciones usan su pictograma y los archivos existen en public/', () => {
    const alimentaciones = OT_CATALOGO_FARMALOGICA.slice(0, 3);
    expect(alimentaciones.map((a) => otPictograma(a.icono))).toEqual([
      '/bitacora-proceso/alimentacion-tapon.webp',
      '/bitacora-proceso/alimentacion-mprima.webp',
      '/bitacora-proceso/alimentacion-agrafe.webp',
    ]);
    for (const src of Object.values(OT_PICTOGRAMAS)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio (OT_PICTOGRAMAS)
      expect(existsSync(fileURLToPath(new URL(`../../../public${src}`, import.meta.url)))).toBe(true);
    }
    expect(otPictograma('pesaje')).toBeNull();
    expect(otPictograma(null)).toBeNull();
  });
});
