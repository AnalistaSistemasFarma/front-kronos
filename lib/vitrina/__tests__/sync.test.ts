import { describe, expect, it } from 'vitest';
import { fuenteDeEmpresa } from '../rules';
import { planSincronizacion, textoResumen, type CodigoExistente } from '../sync';

const FARMA = fuenteDeEmpresa(1)!;
const RYAN = fuenteDeEmpresa(2)!;
const HOY = '2026-10-22';
const vendible = (ItemCode: string, extra: Record<string, unknown> = {}) => ({ ItemCode, ItemName: `Nombre ${ItemCode}`, ItemsGroupCode: 130, SalesItem: 'tYES', Valid: 'tYES', Frozen: 'tNO', ...extra });
const existente = (item_code: string, extra: Partial<CodigoExistente> = {}): CodigoExistente => ({
  id_codigo_sap: 10,
  item_code,
  item_name: `Nombre ${item_code}`,
  items_group_code: 130,
  activo_en_sap: true,
  activado_vitrina: false,
  registro_estado: 'SIN_REGISTRO',
  registro_sanitario: null,
  registro_vence_en: null,
  leido: true,
  ...extra,
});

describe('Vitrina · plan de sincronización con SAP', () => {
  it('toma el país del registro sanitario de SAP, sin pisar el que puso un administrador', () => {
    const reg = (U_Referencia: string, U_Pais: string) => ({ U_Referencia, U_Registro_Sanitario: 'R', U_Fecha_Vencimiento: '2029-01-01T00:00:00Z', U_Obsoleto: 'NO', U_Pais });
    const plan = planSincronizacion({
      fuente: FARMA,
      existentes: [existente('PTMP0150'), { ...existente('PTMP0151'), id_codigo_sap: 11, pais: 'Otro' }],
      items: [vendible('PTMP0111'), vendible('PTMP0150'), vendible('PTMP0151')],
      registros: [reg('PTMP0111', 'COLOMBIA'), reg('PTMP0150', 'GUATEMALA'), reg('PTMP0151', 'EL SALVADOR')],
      hoy: HOY,
    });
    expect(plan.crear[0].pais).toBe('Colombia');
    expect(plan.actualizar.find((u) => u.item_code === 'PTMP0150')?.data.pais).toBe('Guatemala');
    expect(plan.actualizar.find((u) => u.item_code === 'PTMP0151')?.data.pais).toBeUndefined();
  });

  it('solo los vendibles entran a la bandeja, sin activar nada', () => {
    const plan = planSincronizacion({
      fuente: FARMA,
      existentes: [],
      items: [vendible('PTMP0111'), vendible('PTMP0112', { Frozen: 'tYES' }), vendible('MPXX01')],
      registros: [{ U_Referencia: 'PTMP0111', U_Registro_Sanitario: 'INVIMA X', U_Fecha_Vencimiento: '2026-12-01T00:00:00Z', U_Obsoleto: 'NO' }],
      hoy: HOY,
    });
    expect(plan.crear).toEqual([
      { item_code: 'PTMP0111', item_name: 'Nombre PTMP0111', items_group_code: 130, canal: 'SIN_DATO', sug_familia: 'Carbapenémicos', registro_estado: 'POR_VENCER', registro_sanitario: 'INVIMA X', registro_vence_en: '2026-12-01', pais: null },
    ]);
    expect(plan.leidos).toEqual(['PTMP0111', 'PTMP0112']);
    expect(plan.resumen).toMatchObject({ leidosSap: 2, vendibles: 1, nuevos: 1, retirados: 0 });
    expect(plan.crear[0]).not.toHaveProperty('activado_vitrina');
  });

  it('si SAP congela un código activado, se retira de la Vitrina con alerta', () => {
    const plan = planSincronizacion({
      fuente: FARMA,
      existentes: [existente('PTMP0111', { activado_vitrina: true })],
      items: [vendible('PTMP0111', { Frozen: 'tYES' })],
      registros: null,
      hoy: HOY,
    });
    expect(plan.actualizar).toEqual([{ id_codigo_sap: 10, item_code: 'PTMP0111', data: { activo_en_sap: false, activado_vitrina: false } }]);
    expect(plan.eventos[0]).toMatchObject({ accion: 'ALERTA_SAP', item_code: 'PTMP0111' });
    expect(plan.resumen).toMatchObject({ retirados: 1, sinUdoRegistros: true, registrosLeidos: null });
  });

  it('si SAP ya no devuelve el código, también se retira', () => {
    const plan = planSincronizacion({ fuente: FARMA, existentes: [existente('PTMP0999', { activado_vitrina: true })], items: [], registros: [], hoy: HOY });
    expect(plan.actualizar[0].data).toEqual({ activo_en_sap: false, activado_vitrina: false });
    expect(plan.resumen.retirados).toBe(1);
  });

  it('si vuelve a ser vendible, no se reactiva solo', () => {
    const plan = planSincronizacion({ fuente: FARMA, existentes: [existente('PTMP0111', { activo_en_sap: false })], items: [vendible('PTMP0111')], registros: null, hoy: HOY });
    expect(plan.actualizar[0].data).toEqual({ activo_en_sap: true });
    expect(plan.actualizar[0].data).not.toHaveProperty('activado_vitrina');
    expect(plan.resumen.reactivablesEnSap).toBe(1);
  });

  it('un código de la semilla que SAP confirma se marca activo sin alerta', () => {
    const plan = planSincronizacion({ fuente: FARMA, existentes: [existente('PTMP0111', { activo_en_sap: false, leido: false })], items: [vendible('PTMP0111')], registros: null, hoy: HOY });
    expect(plan.actualizar[0].data).toEqual({ activo_en_sap: true });
    expect(plan.eventos).toEqual([]);
  });

  it('recalcula el registro y deja evento solo si cambió', () => {
    const registros = [{ U_Referencia: 'PTMP0111', U_Registro_Sanitario: 'INVIMA X', U_Fecha_Vencimiento: '2026-10-01T00:00:00Z', U_Obsoleto: 'NO' }];
    const plan = planSincronizacion({ fuente: FARMA, existentes: [existente('PTMP0111', { registro_estado: 'VIGENTE', registro_sanitario: 'INVIMA X', registro_vence_en: '2026-10-01' })], items: [vendible('PTMP0111')], registros, hoy: HOY });
    expect(plan.actualizar[0].data).toEqual({ registro_estado: 'VENCIDO', registro_sanitario: 'INVIMA X', registro_vence_en: '2026-10-01' });
    expect(plan.eventos[0].accion).toBe('REGISTRO');
    const igual = planSincronizacion({ fuente: FARMA, existentes: [existente('PTMP0111', { registro_estado: 'VENCIDO', registro_sanitario: 'INVIMA X', registro_vence_en: '2026-10-01' })], items: [vendible('PTMP0111')], registros, hoy: HOY });
    expect(igual.actualizar).toEqual([]);
    expect(igual.eventos).toEqual([]);
  });

  it('Ryan: lee 301, sugiere canal institucional y no sugiere familia', () => {
    const plan = planSincronizacion({
      fuente: RYAN,
      existentes: [],
      items: [vendible('301100008', { ItemName: 'BICARBONATO Institucional (CAJA X 100)', ItemsGroupCode: 103 }), vendible('PTRY0039')],
      registros: null,
      hoy: HOY,
    });
    expect(plan.crear).toHaveLength(1);
    expect(plan.crear[0]).toMatchObject({ item_code: '301100008', canal: 'INSTITUCIONAL', sug_familia: null, registro_estado: 'SIN_REGISTRO' });
    expect(textoResumen('Ryan', plan.resumen)).toContain('sin UDO de registros sanitarios configurado');
  });
});
