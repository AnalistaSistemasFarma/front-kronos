import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  describeOtPermissionMarker,
  isOtIcono,
  isOtPermissionMarkerSubprocess,
  OT_CATALOGO_FARMALOGICA,
  OT_ICONOS,
  OT_SUBPROCESS_NAMES,
  OT_SUBPROCESS_URLS,
  otNombreCompleto,
  otPermissionFromUrl,
} from '../constants';
import {
  assertActividadRegistrable,
  assertPuedeRegistrar,
  buildSapOpFilter,
  companyOtAccess,
  escapeOData,
  isEstado,
  isOtError,
  OtError,
  parseCambioActividad,
  parseCierre,
  parseNuevaActividad,
  parseNuevaOrden,
  parseNuevoRegistro,
  resolveOtAccess,
} from '../rules';
import { isHubHiddenRequestDashboardSubprocess } from '../../request-general/dashboardRoutes';

const FARMA = 1;
const operario = { idCompany: FARMA, companyName: 'FARMALOGICA S.A.', canOperate: true, canManage: false };
const supervisor = { ...operario, canManage: true };

function errorOf(fn: () => unknown): OtError {
  try {
    fn();
  } catch (e) {
    if (isOtError(e)) return e;
    throw e;
  }
  throw new Error('no lanzó');
}

describe('Bitácora de Proceso · permisos', () => {
  it('nombre del módulo y URLs nuevas (la vieja ya no da permiso)', () => {
    expect(OT_SUBPROCESS_URLS).toEqual({ operario: '/process/bitacora-proceso', gestion: '/process/bitacora-proceso/gestion' });
    expect(OT_SUBPROCESS_NAMES.operario).toBe('Bitácora de Proceso');
    expect(otPermissionFromUrl('/process/ordenes-trabajo')).toBeNull();
    expect(otNombreCompleto('FARMALOGICA S.A.')).toBe('Bitácora de Proceso – Plantas Farmalógica');
    expect(otNombreCompleto('LABORATORIOS RYAN')).toBe('Bitácora de Proceso – LABORATORIOS RYAN');
    expect(otNombreCompleto(null)).toBe('Bitácora de Proceso');
  });

  it('reconoce las dos URLs y oculta del hub solo el marcador de Gestión', () => {
    expect(otPermissionFromUrl('/process/bitacora-proceso/')).toBe('operario');
    expect(otPermissionFromUrl('/PROCESS/bitacora-proceso/gestion')).toBe('gestion');
    expect(otPermissionFromUrl('/process/otra')).toBeNull();
    expect(otPermissionFromUrl(null)).toBeNull();
    expect(isOtPermissionMarkerSubprocess({ subprocess_url: OT_SUBPROCESS_URLS.gestion })).toBe(true);
    expect(isOtPermissionMarkerSubprocess({ subprocess_url: OT_SUBPROCESS_URLS.operario })).toBe(false);
    expect(isHubHiddenRequestDashboardSubprocess({ subprocess_url: OT_SUBPROCESS_URLS.gestion })).toBe(true);
    expect(isHubHiddenRequestDashboardSubprocess({ subprocess_url: OT_SUBPROCESS_URLS.operario })).toBe(false);
    expect(describeOtPermissionMarker(OT_SUBPROCESS_URLS.gestion)).toMatch(/supervisor/);
    expect(describeOtPermissionMarker(OT_SUBPROCESS_URLS.operario)).toBeNull();
  });

  it('resuelve el acceso por empresa; Gestión implica operario; ignora URLs ajenas', () => {
    const access = resolveOtAccess([
      { subprocessUrl: OT_SUBPROCESS_URLS.operario, idCompany: 3, companyName: 'ONELATAMPHARMA' },
      { subprocessUrl: OT_SUBPROCESS_URLS.gestion, idCompany: FARMA, companyName: 'FARMALOGICA S.A.' },
      { subprocessUrl: '/process/sgc-documental', idCompany: 5, companyName: 'UNIDOSSIS' },
    ]);
    expect(access).toEqual([
      { idCompany: FARMA, companyName: 'FARMALOGICA S.A.', canOperate: true, canManage: true },
      { idCompany: 3, companyName: 'ONELATAMPHARMA', canOperate: true, canManage: false },
    ]);
    expect(companyOtAccess(access, 3, 'canManage')).toBeNull();
    expect(companyOtAccess(access, 3)?.idCompany).toBe(3);
    expect(companyOtAccess(access, 5)).toBeNull();
  });

  it('no se registra en una orden CERRADA (409), ni siquiera el supervisor', () => {
    expect(errorOf(() => assertPuedeRegistrar({ estado: 'CERRADA', operarios: ['u1'] }, 'u1', operario)).status).toBe(409);
    expect(errorOf(() => assertPuedeRegistrar({ estado: 'CERRADA', operarios: [] }, 'u9', supervisor)).status).toBe(409);
  });

  it('quien no es auxiliar ni inspector y no tiene Gestión recibe 403; el inspector sí registra', () => {
    const e = errorOf(() => assertPuedeRegistrar({ estado: 'ABIERTA', operarios: ['u1'], inspector: 'u3' }, 'u2', operario));
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/no figura como auxiliar ni como inspector/);
    expect(() => assertPuedeRegistrar({ estado: 'ABIERTA', operarios: ['u1'], inspector: 'u3' }, 'u3', operario)).not.toThrow();
    expect(errorOf(() => assertPuedeRegistrar({ estado: 'CERRADA', operarios: [], inspector: 'u3' }, 'u3', operario)).status).toBe(409);
    expect(() => assertPuedeRegistrar({ estado: 'ABIERTA', operarios: ['u1'] }, 'u1', operario)).not.toThrow();
    expect(() => assertPuedeRegistrar({ estado: 'ABIERTA', operarios: [] }, 'u2', supervisor)).not.toThrow();
  });
});

describe('Bitácora de Proceso · validación', () => {
  const base = { company: FARMA, producto: ' Cefazolina 1 g ', lote: '1565426', turno: 'manana', operarios: ['u1', 'u1', ' u2 '], inspector: ' u9 ' };

  it('abre sin OP de SAP (opcional), normaliza turno y operarios', () => {
    const input = parseNuevaOrden(base);
    expect(input).toMatchObject({ idCompany: FARMA, producto: 'Cefazolina 1 g', lote: '1565426', turno: 'MANANA', sapOp: null, area: null, itemCode: null });
    expect(input.operarios).toEqual(['u1', 'u2']);
    expect(input.inspector).toBe('u9');
  });

  it('el inspector es obligatorio', () => {
    expect(errorOf(() => parseNuevaOrden({ ...base, inspector: '' })).message).toMatch(/inspector/);
    expect(errorOf(() => parseNuevaOrden({ ...base, inspector: undefined })).message).toMatch(/inspector/);
    expect(errorOf(() => parseNuevaOrden({ ...base, inspector: 'x'.repeat(51) })).message).toMatch(/Inspector no válido/);
  });

  it('exige producto, lote, turno válido y al menos un operario', () => {
    expect(errorOf(() => parseNuevaOrden(null)).status).toBe(400);
    expect(errorOf(() => parseNuevaOrden({ ...base, company: undefined })).message).toMatch(/empresa/);
    expect(errorOf(() => parseNuevaOrden({ ...base, producto: '  ' })).message).toMatch(/producto/);
    expect(errorOf(() => parseNuevaOrden({ ...base, lote: '' })).message).toMatch(/lote/);
    expect(errorOf(() => parseNuevaOrden({ ...base, turno: 'MADRUGADA' })).message).toMatch(/turno/);
    expect(errorOf(() => parseNuevaOrden({ ...base, operarios: [] })).message).toMatch(/auxiliar/);
    expect(errorOf(() => parseNuevaOrden({ ...base, operarios: 'u1' })).message).toMatch(/auxiliar/);
    expect(errorOf(() => parseNuevaOrden({ ...base, operarios: Array.from({ length: 51 }, (_, i) => `u${i}`) })).message).toMatch(/Máximo/);
    expect(errorOf(() => parseNuevaOrden({ ...base, operarios: ['x'.repeat(51)] })).message).toMatch(/no válido/);
    expect(errorOf(() => parseNuevaOrden({ ...base, lote: 'x'.repeat(51) })).message).toMatch(/máximo 50/);
    expect(errorOf(() => parseNuevaOrden({ ...base, area: 'x'.repeat(101) })).message).toMatch(/área/);
  });

  it('guarda una copia acotada de la OP de SAP (solo los campos conocidos)', () => {
    const input = parseNuevaOrden({
      ...base,
      sapOp: { AbsoluteEntry: 14259, DocumentNumber: 14045, ItemNo: 'PTCZ0121', ProductDescription: 'CEFAZOLINA 1g', U_Cod_Lote: '1565426', U_FecVen_lote: '2029-07-31T00:00:00Z', PlannedQuantity: 41600, Warehouse: 'BQAPT', Otro: 'x' },
    });
    expect(input.sapOp).toEqual({ AbsoluteEntry: 14259, DocumentNumber: 14045, ItemNo: 'PTCZ0121', ProductDescription: 'CEFAZOLINA 1g', U_Cod_Lote: '1565426', U_FecVen_lote: '2029-07-31T00:00:00Z', PlannedQuantity: 41600, Warehouse: 'BQAPT' });
    expect(parseNuevaOrden({ ...base, sapOp: { AbsoluteEntry: 1, DocumentNumber: 2, PlannedQuantity: 'x' } }).sapOp?.PlannedQuantity).toBeNull();
    expect(errorOf(() => parseNuevaOrden({ ...base, sapOp: [] })).status).toBe(400);
    expect(errorOf(() => parseNuevaOrden({ ...base, sapOp: { AbsoluteEntry: 1 } })).status).toBe(400);
    expect(errorOf(() => parseNuevaOrden({ ...base, sapOp: { AbsoluteEntry: -1, DocumentNumber: 2 } })).status).toBe(400);
  });

  it('IGNORA cualquier hora o usuario que envíe el cliente en el registro', () => {
    const input = parseNuevoRegistro({ id_actividad: 3, observacion: ' ok ', registrado_en: '2020-01-01T00:00:00Z', fecha: 'ayer', id_user: 'otro' });
    expect(input).toEqual({ idActividad: 3, observacion: 'ok' });
    expect(parseNuevoRegistro({ idActividad: '4' })).toEqual({ idActividad: 4, observacion: null });
    expect(errorOf(() => parseNuevoRegistro({})).message).toMatch(/actividad/);
    expect(errorOf(() => parseNuevoRegistro(null)).status).toBe(400);
    expect(errorOf(() => parseNuevoRegistro({ id_actividad: 1, observacion: 'x'.repeat(501) })).message).toMatch(/500/);
  });

  it('la observación es obligatoria cuando la actividad lo exige; no se registra en una inactiva', () => {
    const otra = { activo: true, exige_observacion: true, nombre: 'Otra' };
    expect(errorOf(() => assertActividadRegistrable(otra, null)).message).toMatch(/exige una observación/);
    expect(() => assertActividadRegistrable(otra, 'Cambio de filtro')).not.toThrow();
    expect(() => assertActividadRegistrable({ ...otra, exige_observacion: false }, null)).not.toThrow();
    expect(errorOf(() => assertActividadRegistrable({ ...otra, activo: false }, 'x')).status).toBe(400);
    expect(errorOf(() => assertActividadRegistrable(null, null)).status).toBe(400);
  });

  it('cierre: observación opcional con límite', () => {
    expect(parseCierre(null)).toEqual({ observacion: null });
    expect(parseCierre({ observacion: ' fin ' })).toEqual({ observacion: 'fin' });
    expect(errorOf(() => parseCierre({ observacion: 'x'.repeat(1001) })).status).toBe(400);
  });

  it('catálogo: alta y PATCH solo de activo, orden y exige observación', () => {
    expect(parseNuevaActividad({ company: 1, nombre: ' Limpieza ', exige_observacion: true, orden: 15 })).toEqual({ idCompany: 1, nombre: 'Limpieza', exigeObservacion: true, orden: 15, icono: null });
    expect(parseNuevaActividad({ company: 1, nombre: 'Pesaje', icono: 'pesaje' }).icono).toBe('pesaje');
    expect(errorOf(() => parseNuevaActividad({ company: 1, nombre: 'X', icono: '<script>' })).message).toMatch(/ícono/);
    expect(parseCambioActividad({ company: 1, id_actividad: 2, icono: 'uv' })).toEqual({ idActividad: 2, idCompany: 1, icono: 'uv' });
    expect(parseCambioActividad({ company: 1, id_actividad: 2, icono: null })).toEqual({ idActividad: 2, idCompany: 1, icono: null });
    expect(errorOf(() => parseCambioActividad({ company: 1, id_actividad: 2, icono: 'no-existe' })).status).toBe(400);
    expect(parseNuevaActividad({ company: 1, nombre: 'X' }).orden).toBe(0);
    expect(errorOf(() => parseNuevaActividad({ company: 1, nombre: '' })).status).toBe(400);
    expect(errorOf(() => parseNuevaActividad({ nombre: 'x' })).status).toBe(400);
    expect(errorOf(() => parseNuevaActividad(null)).status).toBe(400);
    expect(errorOf(() => parseNuevaActividad({ company: 1, nombre: 'x', orden: -1 })).status).toBe(400);
    expect(parseCambioActividad({ company: 1, id_actividad: 2, activo: false, nombre: 'otro nombre' })).toEqual({ idActividad: 2, idCompany: 1, activo: false });
    expect(parseCambioActividad({ company: 1, id_actividad: 2, exige_observacion: true, orden: 5 })).toEqual({ idActividad: 2, idCompany: 1, exigeObservacion: true, orden: 5 });
    expect(errorOf(() => parseCambioActividad({ company: 1, id_actividad: 2, nombre: 'solo nombre' })).message).toMatch(/No hay cambios/);
    expect(errorOf(() => parseCambioActividad({ company: 1 })).status).toBe(400);
    expect(errorOf(() => parseCambioActividad(null)).status).toBe(400);
  });

  it('filtro OData de OP liberadas: escapa comillas y busca por número', () => {
    expect(escapeOData("o'neil")).toBe("o''neil");
    const f = buildSapOpFilter("PTCZ'");
    expect(f).toContain("ProductionOrderStatus eq 'boposReleased'");
    expect(f).toContain("contains(ItemNo,'PTCZ''')");
    expect(f).not.toContain('DocumentNumber');
    expect(buildSapOpFilter('14045')).toContain('DocumentNumber eq 14045');
    expect(isEstado('ABIERTA')).toBe(true);
    expect(isEstado('ANULADA')).toBe(false);
  });
});

describe('Bitácora de Proceso · catálogo de Farmalógica', () => {
  it('trae las 13 intervenciones de la especificación (sin el «Descargue autoclave» repetido) más «Otra»', () => {
    const nombres = OT_CATALOGO_FARMALOGICA.map((a) => a.nombre);
    expect(nombres).toHaveLength(14);
    expect(new Set(nombres.map((n) => n.toLowerCase())).size).toBe(14);
    expect(nombres.slice(0, 3)).toEqual(['Alimentación Tapón', 'Alimentación MPrima', 'Alimentación Agrafe']);
    expect(nombres).toContain('Descargue Autoclave');
    expect(nombres).toContain('Refrigerio/almuerzo/cena');
    expect(OT_CATALOGO_FARMALOGICA.find((a) => a.nombre === 'Otra')).toMatchObject({ exigeObservacion: true });
    expect(OT_CATALOGO_FARMALOGICA.every((a) => isOtIcono(a.icono))).toBe(true);
    expect(isOtIcono('otra')).toBe(true);
    expect(isOtIcono('toString')).toBe(false);
    expect(Object.keys(OT_ICONOS).length).toBeGreaterThanOrEqual(14);
  });

  it('la siembra SQL coincide con el catálogo del código (nombre, orden, ícono y observación)', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta fija del repositorio, no viene de un usuario
    const sql = readFileSync(fileURLToPath(new URL('../../../prisma/manual/2026-10-13-bitacora-proceso-p0-farmalogica.sql', import.meta.url)), 'utf8');
    const filas = [...sql.matchAll(/\(N'([^']+)',\s*([01]),\s*(\d+),\s*N'([^']+)'\)/g)].map((m) => ({
      nombre: m[1],
      exigeObservacion: m[2] === '1',
      orden: Number(m[3]),
      icono: m[4],
    }));
    expect(filas).toEqual(OT_CATALOGO_FARMALOGICA.map((a) => ({ nombre: a.nombre, exigeObservacion: a.exigeObservacion, orden: a.orden, icono: a.icono })));
  });
});
