import { describe, expect, it } from 'vitest';
import { buildCreatePayload, buildUpdatePayload, odataString, sanitizeLine, validateDraft } from './drafts';

const requester = { sapsendUserId: 32, name: 'Ana Perez', email: 'ana@empresa.com', departmentId: '12' };
const line = {
  ItemDescription: 'guantes de nitrilo',
  Quantity: '10',
  UnitPrice: 2500,
  TaxCode: 'IVA19',
  AccountCode: '51359501',
  CostingCode: 'ADM',
  LineVendor: 'P900123',
  U_NombreProveedor: 'PROVEEDOR SAS',
  Extra: 'se descarta',
};

describe('sanitizeLine', () => {
  it('descarta campos no permitidos, convierte numeros y pasa la descripcion a mayusculas', () => {
    const l = sanitizeLine(line);
    expect(l).not.toHaveProperty('Extra');
    expect(l.Quantity).toBe(10);
    expect(l.ItemDescription).toBe('GUANTES DE NITRILO');
  });
});

describe('validateDraft', () => {
  it('acepta un borrador completo', () => {
    expect(validateDraft({ Comments: 'Compra mensual' }, [sanitizeLine(line)])).toEqual([]);
  });
  it('exige comentario, lineas y campos obligatorios', () => {
    expect(validateDraft({}, []).map((e) => e.field)).toEqual(['Comments', 'DocumentLines']);
    const errs = validateDraft({ Comments: 'x' }, [sanitizeLine({ ItemDescription: 'a', Quantity: 0 })]);
    expect(errs.map((e) => e.field)).toEqual(
      expect.arrayContaining(['DocumentLines[0].TaxCode', 'DocumentLines[0].Quantity'])
    );
  });
});

describe('buildCreatePayload', () => {
  it('replica el payload de SAPSEND en estado B', () => {
    const p = buildCreatePayload({ Comments: ' Compra ' }, [sanitizeLine(line)], requester, '2026-10-20');
    expect(p).toMatchObject({
      Comments: 'Compra',
      DocDate: '2026-10-20',
      DocDueDate: '2026-10-20',
      RequriedDate: '2026-10-20',
      CardCode: 'P900123',
      CardName: 'PROVEEDOR SAS',
      U_SEND_UserId: 32,
      U_SEND_Dep: '12',
      U_SEND_State: 'B',
      DocObjectCode: 'oPurchaseRequest',
    });
    expect(p.DocumentLines[0]).toMatchObject({ Rate: null, LineTotal: null });
  });
});

describe('buildUpdatePayload', () => {
  it('no toca solicitante, departamento ni estado', () => {
    const p = buildUpdatePayload({ Comments: 'x' }, [sanitizeLine(line)]);
    expect(p).not.toHaveProperty('U_SEND_Dep');
    expect(p).not.toHaveProperty('U_SEND_State');
    expect(p).not.toHaveProperty('U_SEND_UserId');
  });
});

describe('odataString', () => {
  it('escapa comillas simples', () => {
    expect(odataString("O'Brien")).toBe("'O''Brien'");
  });
});
