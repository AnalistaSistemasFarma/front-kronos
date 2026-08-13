import { describe, it, expect } from 'vitest';
import {
  buildProposalRows,
  buildFilename,
  slugify,
  stampDate,
} from '../exportProposalExcel';
import type { SupplierGroup } from '../proposal';

// Pruebas de la exportación a Excel del Asistente de Pagos. Se enfocan en la
// parte PURA (aplanado a nivel de factura, slug y nombre de archivo); la
// descarga en sí depende del navegador (file-saver) y no se prueba aquí.
// Todos los datos son SINTÉTICOS.

/** Helper: fabrica un grupo sintético con sus facturas. */
function group(overrides: Partial<SupplierGroup>, invoices: SupplierGroup['invoices']): SupplierGroup {
  return {
    cardCode: 'PROV-1',
    cardName: 'Proveedor Uno',
    invoices,
    invoiceCount: invoices.length,
    totalPending: invoices.reduce((s, i) => s + i.pendingAmount, 0),
    bankAccounts: [],
    defaultBankAccount: null,
    hasBankData: true,
    country: 'CO',
    isForeign: false,
    ...overrides,
  };
}

const baseInvoice = {
  docEntry: 1,
  docNum: 1001,
  cardCode: 'PROV-1',
  cardName: 'Proveedor Uno',
  docDate: '2026-08-01T00:00:00Z',
  docDueDate: '2026-08-31T00:00:00Z',
  docTotal: 100000,
  paidToDate: 40000,
  pendingAmount: 60000,
  docCurrency: 'COP',
};

describe('buildProposalRows', () => {
  it('genera una fila por factura repitiendo los datos del proveedor', () => {
    const g = group({}, [
      baseInvoice,
      { ...baseInvoice, docEntry: 2, docNum: 1002, pendingAmount: 20000 },
    ]);
    const rows = buildProposalRows([g]);
    expect(rows).toHaveLength(2);
    expect(rows[0].proveedor).toBe('Proveedor Uno');
    expect(rows[0].codigo).toBe('PROV-1');
    expect(rows[0].pais).toBe('CO');
    expect(rows[0].documento).toBe(1001);
    expect(rows[1].documento).toBe(1002);
    expect(rows[0].banco).toBe('Sí');
  });

  it('recorta las fechas a YYYY-MM-DD y conserva montos numéricos', () => {
    const rows = buildProposalRows([group({}, [baseInvoice])]);
    expect(rows[0].fecha).toBe('2026-08-01');
    expect(rows[0].vencimiento).toBe('2026-08-31');
    expect(rows[0].total).toBe(100000);
    expect(rows[0].pagado).toBe(40000);
    expect(rows[0].pendiente).toBe(60000);
  });

  it('marca "No" cuando el proveedor no tiene datos bancarios', () => {
    const rows = buildProposalRows([group({ hasBankData: false }, [baseInvoice])]);
    expect(rows[0].banco).toBe('No');
  });

  it('devuelve arreglo vacío cuando no hay grupos', () => {
    expect(buildProposalRows([])).toEqual([]);
  });
});

describe('slugify', () => {
  it('normaliza acentos, espacios y mayúsculas', () => {
    expect(slugify('One Latam Pharma')).toBe('one-latam-pharma');
    expect(slugify('Farmalógica S.A.')).toBe('farmalogica-s-a');
  });

  it('cae en "empresa" cuando queda vacío', () => {
    expect(slugify('   ')).toBe('empresa');
  });
});

describe('buildFilename', () => {
  it('arma el nombre con empresa, pestaña y sello de fecha', () => {
    const d = new Date(2026, 7, 13); // 2026-08-13 (local)
    expect(buildFilename('One Latam Pharma', 'nacional', d)).toBe(
      'propuesta-pagos-one-latam-pharma-nacional-20260813.xlsx'
    );
    expect(buildFilename('One Latam Pharma', 'exterior', d)).toBe(
      'propuesta-pagos-one-latam-pharma-exterior-20260813.xlsx'
    );
  });
});

describe('stampDate', () => {
  it('formatea AAAAMMDD con ceros a la izquierda', () => {
    expect(stampDate(new Date(2026, 0, 5))).toBe('20260105');
  });
});
