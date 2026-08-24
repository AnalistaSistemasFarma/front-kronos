import { describe, it, expect } from 'vitest';
import {
  buildPaymentProposal,
  type SupplierInvoice,
  type SupplierBankAccount,
} from '../proposal';

// Pruebas de `buildPaymentProposal` — la función PURA que arma la propuesta de
// pago del Asistente de Pagos. No hay SAP en vivo: todos los datos de abajo son
// SINTÉTICOS (NIT, cuentas, códigos y nombres inventados; no son proveedores ni
// cuentas reales).

/** Helper: fabrica una factura sintética con lo mínimo relevante. */
function inv(
  cardCode: string,
  cardName: string,
  docEntry: number,
  docTotal: number,
  paidToDate: number
): SupplierInvoice {
  return {
    docEntry,
    docNum: docEntry + 1000,
    cardCode,
    cardName,
    docDate: '2026-08-01',
    docDueDate: '2026-08-31',
    docTotal,
    paidToDate,
    pendingAmount: docTotal - paidToDate,
    docCurrency: 'COP',
  };
}

/** Helper: fabrica una cuenta bancaria sintética. */
function bank(
  bankCode: string,
  accountNo: string,
  isDefault = false
): SupplierBankAccount {
  return { bankCode, accountNo, branch: '001', isDefault };
}

describe('buildPaymentProposal', () => {
  it('agrupa las facturas por proveedor y cuenta las facturas', () => {
    const invoices = [
      inv('P001', 'Zeta Distribuciones', 1, 100_000, 0),
      inv('P001', 'Zeta Distribuciones', 2, 50_000, 0),
      inv('P002', 'Alfa Insumos', 3, 30_000, 0),
    ];

    const proposal = buildPaymentProposal(invoices, {});

    expect(proposal.supplierCount).toBe(2);
    expect(proposal.invoiceCount).toBe(3);

    const zeta = proposal.groups.find((g) => g.cardCode === 'P001')!;
    const alfa = proposal.groups.find((g) => g.cardCode === 'P002')!;
    expect(zeta.invoiceCount).toBe(2);
    expect(zeta.invoices).toHaveLength(2);
    expect(alfa.invoiceCount).toBe(1);
  });

  it('calcula totalPending por proveedor y grandTotalPending global', () => {
    const invoices = [
      // P001: (100.000-20.000) + (50.000-0) = 130.000
      inv('P001', 'Zeta Distribuciones', 1, 100_000, 20_000),
      inv('P001', 'Zeta Distribuciones', 2, 50_000, 0),
      // P002: (30.000-5.000) = 25.000
      inv('P002', 'Alfa Insumos', 3, 30_000, 5_000),
    ];

    const proposal = buildPaymentProposal(invoices, {});

    const zeta = proposal.groups.find((g) => g.cardCode === 'P001')!;
    const alfa = proposal.groups.find((g) => g.cardCode === 'P002')!;
    expect(zeta.totalPending).toBe(130_000);
    expect(alfa.totalPending).toBe(25_000);
    expect(proposal.grandTotalPending).toBe(155_000);
  });

  it('elige la cuenta marcada isDefault como defaultBankAccount', () => {
    const invoices = [inv('P001', 'Zeta Distribuciones', 1, 100_000, 0)];
    const banks: Record<string, SupplierBankAccount[]> = {
      P001: [
        bank('1040', '111', false),
        bank('1051', '222', true),
        bank('1007', '333', false),
      ],
    };

    const proposal = buildPaymentProposal(invoices, banks);
    const zeta = proposal.groups[0];

    expect(zeta.hasBankData).toBe(true);
    expect(zeta.defaultBankAccount).not.toBeNull();
    expect(zeta.defaultBankAccount!.accountNo).toBe('222');
    expect(zeta.defaultBankAccount!.isDefault).toBe(true);
  });

  it('cae a la primera cuenta cuando ninguna está marcada isDefault', () => {
    const invoices = [inv('P001', 'Zeta Distribuciones', 1, 100_000, 0)];
    const banks: Record<string, SupplierBankAccount[]> = {
      P001: [bank('1040', '111', false), bank('1051', '222', false)],
    };

    const proposal = buildPaymentProposal(invoices, banks);
    const zeta = proposal.groups[0];

    expect(zeta.defaultBankAccount).not.toBeNull();
    expect(zeta.defaultBankAccount!.accountNo).toBe('111');
  });

  it('marca hasBankData=false y suma a suppliersMissingBank cuando no hay cuentas', () => {
    const invoices = [
      inv('P001', 'Zeta Distribuciones', 1, 100_000, 0),
      inv('P002', 'Alfa Insumos', 2, 30_000, 0),
    ];
    // Solo P001 tiene banco; P002 no aparece en el mapa.
    const banks: Record<string, SupplierBankAccount[]> = {
      P001: [bank('1040', '111', true)],
    };

    const proposal = buildPaymentProposal(invoices, banks);

    const alfa = proposal.groups.find((g) => g.cardCode === 'P002')!;
    expect(alfa.hasBankData).toBe(false);
    expect(alfa.bankAccounts).toHaveLength(0);
    expect(alfa.defaultBankAccount).toBeNull();
    expect(proposal.suppliersMissingBank).toEqual(['P002']);
  });

  it('trata un arreglo de cuentas vacío igual que la ausencia de banco', () => {
    const invoices = [inv('P003', 'Beta Servicios', 1, 10_000, 0)];
    const banks: Record<string, SupplierBankAccount[]> = { P003: [] };

    const proposal = buildPaymentProposal(invoices, banks);
    const beta = proposal.groups[0];

    expect(beta.hasBankData).toBe(false);
    expect(beta.defaultBankAccount).toBeNull();
    expect(proposal.suppliersMissingBank).toEqual(['P003']);
  });

  it('ordena los grupos por nombre de proveedor (cardName)', () => {
    const invoices = [
      inv('P001', 'Zeta Distribuciones', 1, 100_000, 0),
      inv('P002', 'Alfa Insumos', 2, 30_000, 0),
      inv('P003', 'Mega Comercial', 3, 20_000, 0),
    ];

    const proposal = buildPaymentProposal(invoices, {});

    expect(proposal.groups.map((g) => g.cardName)).toEqual([
      'Alfa Insumos',
      'Mega Comercial',
      'Zeta Distribuciones',
    ]);
  });

  it('devuelve una propuesta vacía coherente sin facturas', () => {
    const proposal = buildPaymentProposal([], {});

    expect(proposal.groups).toHaveLength(0);
    expect(proposal.supplierCount).toBe(0);
    expect(proposal.invoiceCount).toBe(0);
    expect(proposal.grandTotalPending).toBe(0);
    expect(proposal.suppliersMissingBank).toEqual([]);
  });

  it('reúne todas las facturas de un proveedor aunque lleguen intercaladas', () => {
    const invoices = [
      inv('P001', 'Zeta Distribuciones', 1, 100_000, 0),
      inv('P002', 'Alfa Insumos', 2, 30_000, 0),
      inv('P001', 'Zeta Distribuciones', 3, 40_000, 0),
    ];

    const proposal = buildPaymentProposal(invoices, {});
    const zeta = proposal.groups.find((g) => g.cardCode === 'P001')!;

    expect(zeta.invoiceCount).toBe(2);
    expect(zeta.totalPending).toBe(140_000);
    expect(zeta.invoices.map((i) => i.docEntry)).toEqual([1, 3]);
  });

  it('reporta varios proveedores sin banco en suppliersMissingBank', () => {
    const invoices = [
      inv('P001', 'Zeta Distribuciones', 1, 100_000, 0),
      inv('P002', 'Alfa Insumos', 2, 30_000, 0),
      inv('P003', 'Mega Comercial', 3, 20_000, 0),
    ];
    const banks: Record<string, SupplierBankAccount[]> = {
      P002: [bank('1040', '111', true)],
    };

    const proposal = buildPaymentProposal(invoices, banks);

    expect(proposal.suppliersMissingBank.sort()).toEqual(['P001', 'P003']);
  });
});

describe('buildPaymentProposal — clasificación nacional vs exterior', () => {
  /** Helper: factura con moneda explícita (para casos de moneda extranjera). */
  function invCur(
    cardCode: string,
    cardName: string,
    docEntry: number,
    docTotal: number,
    docCurrency: string
  ): SupplierInvoice {
    return { ...inv(cardCode, cardName, docEntry, docTotal, 0), docCurrency };
  }

  it('clasifica como NACIONAL cuando país es CO y moneda COP', () => {
    const invoices = [inv('P001', 'Nacional SA', 1, 100_000, 0)];
    const proposal = buildPaymentProposal(invoices, {}, { P001: 'CO' });

    const g = proposal.groups[0];
    expect(g.isForeign).toBe(false);
    expect(g.country).toBe('CO');
    expect(proposal.nationalGroups.map((x) => x.cardCode)).toEqual(['P001']);
    expect(proposal.foreignGroups).toHaveLength(0);
  });

  it('clasifica como EXTERIOR cuando el país no es CO', () => {
    const invoices = [inv('X001', 'Foreign Corp', 1, 100_000, 0)];
    const proposal = buildPaymentProposal(invoices, {}, { X001: 'US' });

    const g = proposal.groups[0];
    expect(g.isForeign).toBe(true);
    expect(g.country).toBe('US');
    expect(proposal.foreignGroups.map((x) => x.cardCode)).toEqual(['X001']);
    expect(proposal.nationalGroups).toHaveLength(0);
  });

  it('clasifica como EXTERIOR cuando alguna factura tiene moneda distinta de COP', () => {
    const invoices = [invCur('X002', 'USD Supplier', 1, 100_000, 'USD')];
    // Sin país en el mapa: la clasificación cae en la moneda.
    const proposal = buildPaymentProposal(invoices, {});

    const g = proposal.groups[0];
    expect(g.isForeign).toBe(true);
    expect(proposal.foreignGroups.map((x) => x.cardCode)).toEqual(['X002']);
  });

  it('trata país vacío + moneda COP como NACIONAL', () => {
    const invoices = [inv('P002', 'Sin País', 1, 50_000, 0)];
    const proposal = buildPaymentProposal(invoices, {});

    expect(proposal.groups[0].isForeign).toBe(false);
    expect(proposal.nationalGroups).toHaveLength(1);
  });

  it('parte los grupos en nationalGroups y foreignGroups a la vez', () => {
    const invoices = [
      inv('P001', 'Alfa Nacional', 1, 100_000, 0),
      inv('X001', 'Beta Exterior', 2, 200_000, 0),
      invCur('X002', 'Gamma USD', 3, 300_000, 'USD'),
    ];
    const proposal = buildPaymentProposal(
      invoices,
      {},
      { P001: 'CO', X001: 'PA', X002: 'CO' }
    );

    expect(proposal.nationalGroups.map((g) => g.cardCode)).toEqual(['P001']);
    expect(proposal.foreignGroups.map((g) => g.cardCode).sort()).toEqual(['X001', 'X002']);
    // groups sigue conteniendo todos (compatibilidad).
    expect(proposal.groups).toHaveLength(3);
  });
});
