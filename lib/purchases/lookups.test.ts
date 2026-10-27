import { describe, expect, it } from 'vitest';
import { lookupPath, toOptions } from './lookups';

describe('lookupPath', () => {
  it('escapa el texto del usuario', () => {
    expect(lookupPath('item', "o'neil")).toContain("contains(ItemCode,'o''neil')");
  });
  it('agrupa el or de niveles de cuenta (defecto de SAPSEND)', () => {
    expect(lookupPath('account', '5135')).toContain(
      "(startswith(Code,'5135') or contains(Name,'5135')) and (AccountLevel eq 5 or AccountLevel eq 8) and ActiveAccount eq 'tYES'"
    );
  });
  it('normas de reparto: lista completa (SAP ignora el filtro)', () => {
    expect(lookupPath('costing', 'adm')).toBe('DistributionRulesService_GetDistributionRuleList');
  });
});

describe('toOptions', () => {
  it('al elegir artículo llena descripción y bodega por defecto', () => {
    expect(toOptions('item', [{ ItemCode: 'SERV0001', ItemName: 'Licencia m365', DefaultWarehouse: 'B1103' }], 'serv')[0]).toEqual({
      value: 'SERV0001',
      label: 'SERV0001 · Licencia m365',
      fill: { ItemDescription: 'LICENCIA M365', WarehouseCode: 'B1103' },
    });
  });
  it('al elegir proveedor llena código y nombre', () => {
    expect(toOptions('vendor', [{ CardCode: 'P900', CardName: 'NIMBUTECH' }], 'nim')[0].fill).toEqual({
      LineVendor: 'P900',
      U_NombreProveedor: 'NIMBUTECH',
    });
  });
  it('filtra normas de reparto en memoria por código o descripción', () => {
    const rows = [
      { FactorCode: '1000', FactorDescription: 'ADMINISTRACION' },
      { FactorCode: '2000', FactorDescription: 'TECNOLOGIA' },
    ];
    expect(toOptions('costing', rows, 'tecno').map((o) => o.value)).toEqual(['2000']);
    expect(toOptions('costing', rows, '100').map((o) => o.value)).toEqual(['1000']);
  });
});
