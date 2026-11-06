import { describe, expect, it, vi } from 'vitest';
import { validateLinesInSap, type SapLookups } from './validateSap';

const line = (AccountCode: string, CostingCode: string, TaxCode: string) => ({ AccountCode, CostingCode, TaxCode });

function lookups(over: Partial<SapLookups> = {}): SapLookups {
  return {
    exists: vi.fn().mockResolvedValue(true),
    distributionRuleCodes: vi.fn().mockResolvedValue(new Set(['ADM', '1000'])),
    ...over,
  };
}

describe('validateLinesInSap', () => {
  it('no reporta errores si todo existe', async () => {
    expect(await validateLinesInSap([line('5135', 'ADM', 'IVA19')], lookups())).toEqual([]);
  });

  it('marca el IVA inexistente con su linea', async () => {
    const sap = lookups({ exists: vi.fn(async (path: string) => !path.startsWith('SalesTaxCodes')) });
    expect(await validateLinesInSap([line('5135', 'ADM', 'XX')], sap)).toEqual([
      { field: 'DocumentLines[0].TaxCode', error: expect.stringContaining('IVA no existe') },
    ]);
  });

  it('detecta una norma de reparto inexistente (SAP ignora el filtro de esa lista)', async () => {
    expect(await validateLinesInSap([line('5135', 'NOEXISTE', 'IVA19')], lookups())).toEqual([
      { field: 'DocumentLines[0].CostingCode', error: expect.stringContaining('norma de reparto no existe') },
    ]);
  });

  it('consulta cada codigo distinto una sola vez y la lista de normas una vez', async () => {
    const sap = lookups();
    await validateLinesInSap([line('5135', 'ADM', 'IVA19'), line('5135', '1000', 'IVA19')], sap);
    expect(sap.exists).toHaveBeenCalledTimes(2);
    expect(sap.distributionRuleCodes).toHaveBeenCalledTimes(1);
  });

  it('escapa comillas en el filtro OData', async () => {
    const sap = lookups();
    await validateLinesInSap([line("51'35", 'ADM', 'IVA19')], sap);
    expect(sap.exists).toHaveBeenCalledWith(expect.stringContaining("Code eq '51''35'"));
  });

  it('propaga errores de SAP distintos de no existe', async () => {
    const sap = lookups({ exists: vi.fn().mockRejectedValue(new Error('SAP caido')) });
    await expect(validateLinesInSap([line('5135', 'ADM', 'IVA19')], sap)).rejects.toThrow('SAP caido');
  });
});
