import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  describeOtPermissionMarker,
  isOtIcono,
  isOtPermissionMarkerSubprocess,
  OT_ACTIVIDADES_A6,
  OT_AREAS_FARMALOGICA,
  OT_CATALOGO_FARMALOGICA,
  OT_ICONOS,
  OT_ROL_LABEL,
  OT_TURNO_LABEL,
  OT_SUBPROCESS_NAMES,
  OT_SUBPROCESS_URLS,
  otNombreCompleto,
  otPermissionFromUrl,
} from '../constants';
import {
  assertActividadRegistrable,
  assertOperadorDeLaOrden,
  assertPuedeRegistrar,
  buildSapOpFilter,
  companyOtAccess,
  escapeOData,
  isEstado,
  isOtError,
  opPorNumero,
  OT_SAP_OP_ESTADOS,
  parseImportarOperadores,
  OtError,
  parseAgregarOperadores,
  parseCambioActividad,
  parseCambioArea,
  parseCambioOperador,
  parseCierre,
  parseNuevaActividad,
  parseNuevaArea,
  parseNuevaOrden,
  parseNuevoOperador,
  parseNuevoRegistro,
  resolveOtAccess,
  resolverArea,
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

  it('bitácora anterior (auxiliares con usuario): quien no figura y no tiene Gestión recibe 403; el jefe de producción sí registra', () => {
    const e = errorOf(() => assertPuedeRegistrar({ estado: 'ABIERTA', operarios: ['u1'], inspector: 'u3' }, 'u2', operario));
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/no figura como auxiliar, inspector ni jefe de producción/);
    expect(() => assertPuedeRegistrar({ estado: 'ABIERTA', operarios: ['u1'], jefe: 'u4' }, 'u4', operario)).not.toThrow();
    expect(() => assertPuedeRegistrar({ estado: 'ABIERTA', operarios: ['u1'], inspector: 'u3' }, 'u3', operario)).not.toThrow();
    expect(errorOf(() => assertPuedeRegistrar({ estado: 'CERRADA', operarios: [], inspector: 'u3' }, 'u3', operario)).status).toBe(409);
    expect(() => assertPuedeRegistrar({ estado: 'ABIERTA', operarios: ['u1'] }, 'u1', operario)).not.toThrow();
    expect(() => assertPuedeRegistrar({ estado: 'ABIERTA', operarios: [] }, 'u2', supervisor)).not.toThrow();
  });

  it('A1: con operarios programados registra cualquier sesión con el permiso (cuenta compartida de planta)', () => {
    expect(() => assertPuedeRegistrar({ estado: 'ABIERTA', operarios: [], operadores: [7] }, 'u-planta', operario)).not.toThrow();
    expect(errorOf(() => assertPuedeRegistrar({ estado: 'CERRADA', operarios: [], operadores: [7] }, 'u-planta', operario)).status).toBe(409);
  });

  it('A1: el operario elegido debe estar programado; es obligatorio si la bitácora tiene operarios', () => {
    expect(() => assertOperadorDeLaOrden([7, 8], 7)).not.toThrow();
    expect(errorOf(() => assertOperadorDeLaOrden([7, 8], null)).message).toMatch(/Elija primero su nombre/);
    expect(errorOf(() => assertOperadorDeLaOrden([7, 8], 9)).status).toBe(403);
    expect(() => assertOperadorDeLaOrden([], null)).not.toThrow();
    expect(errorOf(() => assertOperadorDeLaOrden([], 7)).status).toBe(400);
  });
});

describe('Bitácora de Proceso · validación', () => {
  const base = { company: FARMA, producto: ' Cefazolina 1 g ', lote: '1565426', turno: 'manana', operadores: [7, 7, '8'], idArea: 3, inspector: ' u9 ', jefeProduccion: ' u8 ' };

  it('abre sin OP de SAP (opcional), normaliza turno, operarios (sin usuario) y área del catálogo', () => {
    const input = parseNuevaOrden(base);
    expect(input).toMatchObject({ idCompany: FARMA, producto: 'Cefazolina 1 g', lote: '1565426', turno: 'MANANA', sapOp: null, idArea: 3, itemCode: null });
    expect(input.operadores).toEqual([7, 8]);
    expect(input.inspector).toBe('u9');
    expect(input.jefeProduccion).toBe('u8');
    expect(parseNuevaOrden({ ...base, idArea: undefined }).idArea).toBeNull();
    // El área ya no es texto libre: un texto en `area` se ignora.
    expect(parseNuevaOrden({ ...base, area: 'Texto libre' })).not.toHaveProperty('area');
  });

  it('B1: inspector y jefe de producción son campos distintos y obligatorios', () => {
    expect(errorOf(() => parseNuevaOrden({ ...base, inspector: '' })).message).toMatch(/inspector/);
    expect(errorOf(() => parseNuevaOrden({ ...base, inspector: undefined })).message).toMatch(/inspector/);
    expect(errorOf(() => parseNuevaOrden({ ...base, inspector: 'x'.repeat(51) })).message).toMatch(/Inspector no válido/);
    expect(errorOf(() => parseNuevaOrden({ ...base, jefeProduccion: '' })).message).toMatch(/jefe de producción/);
    expect(errorOf(() => parseNuevaOrden({ ...base, jefeProduccion: 'x'.repeat(51) })).message).toMatch(/Jefe de producción no válido/);
    // El jefe ya no se toma del campo del inspector (el #617 los fusionaba).
    expect(errorOf(() => parseNuevaOrden({ ...base, jefeProduccion: undefined })).status).toBe(400);
  });

  it('exige producto, lote, turno válido y al menos un operario', () => {
    expect(errorOf(() => parseNuevaOrden(null)).status).toBe(400);
    expect(errorOf(() => parseNuevaOrden({ ...base, company: undefined })).message).toMatch(/empresa/);
    expect(errorOf(() => parseNuevaOrden({ ...base, producto: '  ' })).message).toMatch(/producto/);
    expect(errorOf(() => parseNuevaOrden({ ...base, lote: '' })).message).toMatch(/lote/);
    expect(errorOf(() => parseNuevaOrden({ ...base, turno: 'MADRUGADA' })).message).toMatch(/turno/);
    expect(errorOf(() => parseNuevaOrden({ ...base, operadores: [] })).message).toMatch(/al menos un operario/);
    expect(errorOf(() => parseNuevaOrden({ ...base, operadores: 7 })).message).toMatch(/al menos un operario/);
    expect(errorOf(() => parseNuevaOrden({ ...base, operadores: Array.from({ length: 51 }, (_, i) => i + 1) })).message).toMatch(/máximo/);
    expect(errorOf(() => parseNuevaOrden({ ...base, operadores: ['abc'] })).message).toMatch(/no válido/);
    expect(errorOf(() => parseNuevaOrden({ ...base, operadores: [0] })).message).toMatch(/no válido/);
    expect(errorOf(() => parseNuevaOrden({ ...base, lote: 'x'.repeat(51) })).message).toMatch(/máximo 50/);
    expect(errorOf(() => parseNuevaOrden({ ...base, idArea: -1 })).message).toMatch(/área/);
  });

  it('guarda una copia acotada de la OP de SAP (solo los campos conocidos)', () => {
    const input = parseNuevaOrden({
      ...base,
      sapOp: { AbsoluteEntry: 14259, DocumentNumber: 14045, ItemNo: 'PTCZ0121', ProductDescription: 'CEFAZOLINA 1g', U_Cod_Lote: '1565426', U_FecVen_lote: '2029-07-31T00:00:00Z', PlannedQuantity: 41600, Warehouse: 'BQAPT', ProductionOrderStatus: 'boposPlanned', Otro: 'x' },
    });
    expect(input.sapOp).toEqual({ AbsoluteEntry: 14259, DocumentNumber: 14045, ItemNo: 'PTCZ0121', ProductDescription: 'CEFAZOLINA 1g', U_Cod_Lote: '1565426', U_FecVen_lote: '2029-07-31T00:00:00Z', PlannedQuantity: 41600, Warehouse: 'BQAPT', ProductionOrderStatus: 'boposPlanned' });
    expect(parseNuevaOrden({ ...base, sapOp: { AbsoluteEntry: 1, DocumentNumber: 2, PlannedQuantity: 'x' } }).sapOp?.PlannedQuantity).toBeNull();
    expect(errorOf(() => parseNuevaOrden({ ...base, sapOp: [] })).status).toBe(400);
    expect(errorOf(() => parseNuevaOrden({ ...base, sapOp: { AbsoluteEntry: 1 } })).status).toBe(400);
    expect(errorOf(() => parseNuevaOrden({ ...base, sapOp: { AbsoluteEntry: -1, DocumentNumber: 2 } })).status).toBe(400);
  });

  it('IGNORA cualquier hora o usuario que envíe el cliente en el registro', () => {
    const input = parseNuevoRegistro({ id_actividad: 3, id_operador: 7, observacion: ' ok ', registrado_en: '2020-01-01T00:00:00Z', fecha: 'ayer', id_user: 'otro' });
    expect(input).toEqual({ idActividad: 3, idOperador: 7, observacion: 'ok' });
    expect(parseNuevoRegistro({ idActividad: '4' })).toEqual({ idActividad: 4, idOperador: null, observacion: null });
    expect(errorOf(() => parseNuevoRegistro({ id_actividad: 1, id_operador: 'x' })).message).toMatch(/operario/);
    expect(errorOf(() => parseNuevoRegistro({})).message).toMatch(/actividad/);
    expect(errorOf(() => parseNuevoRegistro(null)).status).toBe(400);
    expect(errorOf(() => parseNuevoRegistro({ id_actividad: 1, observacion: 'x'.repeat(501) })).message).toMatch(/500/);
  });

  it('la observación es OPCIONAL en todas (también en «Otra»); no se registra en una inactiva', () => {
    const otra = { activo: true, exige_observacion: true, nombre: 'Otra' };
    expect(() => assertActividadRegistrable(otra)).not.toThrow();
    expect(errorOf(() => assertActividadRegistrable({ ...otra, activo: false })).status).toBe(400);
    expect(errorOf(() => assertActividadRegistrable(null)).status).toBe(400);
  });

  it('A1: maestro de operarios (nombre obligatorio, documento opcional, solo cambia nombre/documento/activo)', () => {
    expect(parseNuevoOperador({ company: FARMA, nombre: '  Pepito   Pérez ', documento: ' 123 ' })).toEqual({ idCompany: FARMA, nombre: 'Pepito Pérez', documento: '123' });
    expect(parseNuevoOperador({ company: FARMA, nombre: 'Ana' }).documento).toBeNull();
    expect(errorOf(() => parseNuevoOperador({ company: FARMA, nombre: ' ' })).message).toMatch(/nombre/);
    expect(errorOf(() => parseNuevoOperador({ nombre: 'Ana' })).message).toMatch(/empresa/);
    expect(errorOf(() => parseNuevoOperador({ company: FARMA, nombre: 'x'.repeat(121) })).status).toBe(400);
    expect(parseCambioOperador({ company: FARMA, id_operador: 7, activo: false })).toEqual({ idCompany: FARMA, idOperador: 7, activo: false });
    expect(parseCambioOperador({ company: FARMA, id_operador: 7, documento: '' })).toEqual({ idCompany: FARMA, idOperador: 7, documento: null });
    expect(errorOf(() => parseCambioOperador({ company: FARMA, id_operador: 7 })).message).toMatch(/No hay cambios/);
    expect(errorOf(() => parseCambioOperador({ company: FARMA })).status).toBe(400);
    expect(parseAgregarOperadores({ operadores: [3, '3', 4] })).toEqual([3, 4]);
    expect(errorOf(() => parseAgregarOperadores({ operadores: [] })).status).toBe(400);
  });

  it('A5: área del catálogo (obligatoria si la empresa tiene áreas; sin texto libre)', () => {
    const areas = [{ id_area: 3, nombre: 'Envase y agrafado' }];
    expect(resolverArea(areas, 3)).toEqual(areas[0]);
    expect(errorOf(() => resolverArea(areas, null)).message).toMatch(/Seleccione el área/);
    expect(errorOf(() => resolverArea(areas, 9)).status).toBe(400);
    expect(resolverArea([], null)).toBeNull();
    expect(errorOf(() => resolverArea([], 3)).status).toBe(400);
    expect(parseNuevaArea({ company: FARMA, nombre: ' Envase y agrafado ' })).toEqual({ idCompany: FARMA, nombre: 'Envase y agrafado', orden: 0 });
    expect(parseCambioArea({ company: FARMA, id_area: 3, activo: false })).toEqual({ idCompany: FARMA, idArea: 3, activo: false });
    expect(errorOf(() => parseCambioArea({ company: FARMA, id_area: 3 })).status).toBe(400);
    expect(OT_AREAS_FARMALOGICA).toEqual(['Envase y agrafado']);
  });

  it('B1 y A9: etiquetas de los cuatro actores y turnos con horario', () => {
    expect(OT_ROL_LABEL).toEqual({ OPERARIO: 'Operario', SUPERVISOR: 'Supervisor', INSPECTOR: 'Inspector', JEFE_PROD: 'Jefe de producción' });
    expect(OT_TURNO_LABEL).toEqual({ MANANA: 'Mañana (06–14)', TARDE: 'Tarde (14–22)', NOCHE: 'Noche (22–06)' });
  });

  it('A6: actividades nuevas con ícono válido (alistamiento primero; despeje y aseo al final, antes de «Otra»)', () => {
    expect(OT_ACTIVIDADES_A6.map((a) => a.nombre)).toEqual(['Alistamiento inicial', 'Despeje de área (fin de lote)', 'Aseo de área']);
    expect(OT_ACTIVIDADES_A6.every((a) => isOtIcono(a.icono))).toBe(true);
    const primera = Math.min(...OT_CATALOGO_FARMALOGICA.map((a) => a.orden));
    expect(OT_ACTIVIDADES_A6[0].orden).toBeLessThan(primera);
    const otra = OT_CATALOGO_FARMALOGICA.find((a) => a.nombre === 'Otra')!.orden;
    const ultimaNormal = Math.max(...OT_CATALOGO_FARMALOGICA.filter((a) => a.nombre !== 'Otra').map((a) => a.orden));
    for (const a of OT_ACTIVIDADES_A6.slice(1)) {
      expect(a.orden).toBeGreaterThan(ultimaNormal);
      expect(a.orden).toBeLessThan(otra);
    }
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

  it('B5: filtro OData de OP PLANIFICADAS y LIBERADAS (nunca cerradas ni canceladas); escapa comillas y busca por número', () => {
    expect(escapeOData("o'neil")).toBe("o''neil");
    const f = buildSapOpFilter("PTCZ'");
    expect(OT_SAP_OP_ESTADOS).toEqual(['boposPlanned', 'boposReleased']);
    expect(f.startsWith("(ProductionOrderStatus eq 'boposPlanned' or ProductionOrderStatus eq 'boposReleased') and (")).toBe(true);
    expect(f).not.toMatch(/boposClosed|boposCancelled/);
    expect(f).toContain("contains(ItemNo,'PTCZ''')");
    expect(f).not.toContain('DocumentNumber');
    expect(buildSapOpFilter('14045')).toContain('DocumentNumber eq 14045');
    expect(isEstado('ABIERTA')).toBe(true);
    expect(isEstado('ANULADA')).toBe(false);
  });

  it('B5: con el NÚMERO exacto de la OP se elige sola; con texto o varias coincidencias, no', () => {
    const ops = [{ DocumentNumber: 14022 }, { DocumentNumber: 140220 }];
    expect(opPorNumero(' 14022 ', ops)).toEqual({ DocumentNumber: 14022 });
    expect(opPorNumero('PTCZ', ops)).toBeNull();
    expect(opPorNumero('999', ops)).toBeNull();
    expect(opPorNumero('14022', [{ DocumentNumber: 14022 }, { DocumentNumber: 14022 }])).toBeNull();
  });

  it('B8: importar operarios pegando la lista (nombre; documento), con encabezado, repetidos y errores por línea', () => {
    const texto = 'Nombre completo;Documento\r\nAna María  Gómez; 1020 304\nPedro Pérez\n\nana maría gómez;9\n;123\n' + 'x'.repeat(121) + '\nLuis\t' + '9'.repeat(31) + '\nCarla, 55';
    const r = parseImportarOperadores({ company: FARMA, texto });
    expect(r.simular).toBe(true);
    expect(r.filas).toEqual([
      { linea: 2, nombre: 'Ana María Gómez', documento: '1020304' },
      { linea: 3, nombre: 'Pedro Pérez', documento: null },
      { linea: 9, nombre: 'Carla', documento: '55' },
    ]);
    expect(r.errores.map((e) => [e.linea, e.motivo])).toEqual([
      [5, 'Nombre repetido en la lista.'],
      [6, 'Falta el nombre.'],
      [7, 'Nombre de más de 120 caracteres.'],
      [8, 'Documento de más de 30 caracteres.'],
    ]);
    expect(parseImportarOperadores({ company: FARMA, texto: 'Ana', simular: false }).simular).toBe(false);
    expect(errorOf(() => parseImportarOperadores(null)).status).toBe(400);
    expect(errorOf(() => parseImportarOperadores({ texto: 'Ana' })).message).toMatch(/empresa/);
    expect(errorOf(() => parseImportarOperadores({ company: FARMA, texto: '  ' })).message).toMatch(/Pegue/);
    expect(errorOf(() => parseImportarOperadores({ company: FARMA, texto: 'Nombre' })).message).toMatch(/no tiene operarios/);
    expect(errorOf(() => parseImportarOperadores({ company: FARMA, texto: Array.from({ length: 501 }, (_, i) => `Op ${i}`).join('\n') })).message).toMatch(/Máximo 500/);
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

  it('la siembra del 2026-10-14 coincide con OT_ACTIVIDADES_A6 y el área predefinida, y no duplica lo creado en vivo', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta fija del repositorio, no viene de un usuario
    const sql = readFileSync(fileURLToPath(new URL('../../../prisma/manual/2026-10-14-bitacora-proceso-ajustes-farmalogica.sql', import.meta.url)), 'utf8');
    const filas = [...sql.matchAll(/\(N'([^']+)',\s*N'([a-z-]+)',\s*(\d+)\)/g)].map((m) => ({ nombre: m[1], icono: m[2], orden: Number(m[3]) }));
    expect(filas).toEqual(OT_ACTIVIDADES_A6.map((a) => ({ nombre: a.nombre, icono: a.icono, orden: a.orden })));
    for (const area of OT_AREAS_FARMALOGICA) expect(sql).toContain(`N'${area}'`);
    // Alias de lo que Nicolás creó en vivo en pruebas: no se insertan de nuevo.
    expect(sql).toContain("N'Despeje del área'");
    expect(sql).toContain("N'Aseo del área'");
    expect(sql).toMatch(/@DesactivarFinDeLote BIT = 0/);
  });
});
