import { describe, it, expect } from 'vitest';
import {
  proposalToDisfon,
  deriveBeneficiaryIdentity,
  type DisfonEmpresaConfig,
} from '../disfonMapping';
import { LINE_LEN } from '../disfon';
import type { SupplierGroup, SupplierInvoice, SupplierBankAccount } from '../proposal';

// Pruebas del mapeo Propuesta -> DISFON. Todos los datos son SINTÉTICOS (NIT,
// cuentas, códigos y nombres inventados). No hay SAP ni red: función pura.

const config: DisfonEmpresaConfig = {
  cuentaDispersora: '12345678901',
  tipoCuenta: '1',
  nit: '8600000006',
  tipoMovimiento: '002',
  codigoCiudad: '0001',
  codigoOficina: '001',
  tipoId: 'N',
  nombreEmpresa: 'EMPRESA DISPERSORA SA',
};

function inv(
  cardCode: string,
  cardName: string,
  docNum: number,
  pendingAmount: number
): SupplierInvoice {
  return {
    docEntry: docNum - 1000,
    docNum,
    cardCode,
    cardName,
    docDate: '2026-08-01',
    docDueDate: '2026-08-31',
    docTotal: pendingAmount,
    paidToDate: 0,
    pendingAmount,
    docCurrency: 'COP',
  };
}

function acc(
  bankCode: string,
  accountNo: string,
  isDefault = true
): SupplierBankAccount {
  return { bankCode, accountNo, branch: '', isDefault };
}

function group(
  cardCode: string,
  cardName: string,
  invoices: SupplierInvoice[],
  bankAccounts: SupplierBankAccount[]
): SupplierGroup {
  const totalPending = invoices.reduce((s, i) => s + i.pendingAmount, 0);
  const defaultBankAccount =
    bankAccounts.find((a) => a.isDefault) ?? bankAccounts[0] ?? null;
  return {
    cardCode,
    cardName,
    invoices,
    invoiceCount: invoices.length,
    totalPending,
    bankAccounts,
    defaultBankAccount,
    hasBankData: bankAccounts.length > 0,
  };
}

const opts = {
  fechaAplicacion: '20260813',
  identities: {
    P001: { tipoId: 'N', numeroId: '9001234567' },
    P002: { tipoId: 'C', numeroId: '52123456' },
  },
};

describe('proposalToDisfon', () => {
  it('mapea montos a centavos (round) correctamente', () => {
    const g = group('P001', 'Proveedor Uno', [inv('P001', 'Proveedor Uno', 5001, 47240.005)], [
      acc('Bancolombia', '11122233344'),
    ]);
    const res = proposalToDisfon(config, [g], opts);
    // 47240.005 * 100 = 4724000.5 -> round -> 4724001 centavos.
    // money() en la línea de detalle: 18 dígitos con ceros a la izquierda.
    const detail = res.fileText.split('\n')[1];
    expect(detail.slice(72, 90)).toBe('000000000004724001');
  });

  it('resuelve el código de banco y lo coloca en el detalle', () => {
    const g = group('P001', 'Proveedor Uno', [inv('P001', 'Proveedor Uno', 5001, 1000)], [
      acc('Banco de Bogotá', '99988877766'),
    ]);
    const res = proposalToDisfon(config, [g], opts);
    const detail = res.fileText.split('\n')[1];
    // Código banco beneficiario en col 95-97 (índices 94-97).
    expect(detail.slice(94, 97)).toBe('001');
    expect(res.warnings).toHaveLength(0);
  });

  it('reporta warning cuando el banco no está en el catálogo (y usa 000)', () => {
    const g = group('P001', 'Proveedor Uno', [inv('P001', 'Proveedor Uno', 5001, 1000)], [
      acc('Banco Marciano', '99988877766'),
    ]);
    const res = proposalToDisfon(config, [g], opts);
    const detail = res.fileText.split('\n')[1];
    expect(detail.slice(94, 97)).toBe('000');
    expect(res.warnings.some((w) => w.includes('no está en el catálogo'))).toBe(true);
  });

  it('reporta warning cuando el proveedor no tiene cuenta bancaria', () => {
    const g = group('P001', 'Proveedor Uno', [inv('P001', 'Proveedor Uno', 5001, 1000)], []);
    const res = proposalToDisfon(config, [g], opts);
    expect(res.warnings.some((w) => w.includes('sin cuenta bancaria'))).toBe(true);
    // El archivo se arma igual (previsualización), sin lanzar.
    expect(res.fileText.split('\n').filter(Boolean)).toHaveLength(2);
  });

  it('reporta warning cuando el monto es 0', () => {
    const g = group('P001', 'Proveedor Uno', [inv('P001', 'Proveedor Uno', 5001, 0)], [
      acc('Bancolombia', '11122233344'),
    ]);
    const res = proposalToDisfon(config, [g], opts);
    expect(res.warnings.some((w) => w.includes('monto a pagar es 0'))).toBe(true);
  });

  it('reporta warning cuando falta la identificación del beneficiario', () => {
    const g = group('P999', 'Proveedor Sin Id', [inv('P999', 'Proveedor Sin Id', 5001, 1000)], [
      acc('Bancolombia', '11122233344'),
    ]);
    const res = proposalToDisfon(config, [g], opts);
    expect(res.warnings.some((w) => w.includes('sin identificación'))).toBe(true);
  });

  it('todas las líneas miden exactamente LINE_LEN y la cabecera trae el conteo', () => {
    const groups = [
      group('P001', 'Proveedor Uno', [inv('P001', 'Proveedor Uno', 5001, 1000)], [
        acc('Bancolombia', '11122233344'),
      ]),
      group('P002', 'Proveedor Dos', [inv('P002', 'Proveedor Dos', 5002, 2500)], [
        acc('Davivienda', '55566677788'),
      ]),
    ];
    const res = proposalToDisfon(config, groups, opts);
    const lines = res.fileText.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3); // 1 cabecera + 2 detalles
    for (const line of lines) expect(line.length).toBe(LINE_LEN);
    // Cabecera: tipo registro '1' y el conteo de detalles (5 dígitos, col 10-14).
    expect(lines[0][0]).toBe('1');
    expect(lines[0].slice(9, 14)).toBe('00002');
    expect(res.detailCount).toBe(2);
  });

  it('consolida por proveedor con el total pendiente de todas sus facturas', () => {
    const g = group(
      'P001',
      'Proveedor Uno',
      [
        inv('P001', 'Proveedor Uno', 5001, 1000),
        inv('P001', 'Proveedor Uno', 5002, 2000),
      ],
      [acc('Bancolombia', '11122233344')]
    );
    const res = proposalToDisfon(config, [g], opts);
    const detail = res.fileText.split('\n')[1];
    // 3000 * 100 = 300000 centavos.
    expect(detail.slice(72, 90)).toBe('000000000000300000');
    // Con varias facturas, nº de factura queda en el default '0'.
    expect(res.detailCount).toBe(1);
  });

  it('devuelve fileText vacío cuando no hay grupos', () => {
    const res = proposalToDisfon(config, [], opts);
    expect(res.fileText).toBe('');
    expect(res.detailCount).toBe(0);
  });
});

describe('deriveBeneficiaryIdentity (heurística provisional)', () => {
  it('devuelve null cuando no hay documento', () => {
    expect(deriveBeneficiaryIdentity('')).toBeNull();
    expect(deriveBeneficiaryIdentity(null)).toBeNull();
    expect(deriveBeneficiaryIdentity(undefined)).toBeNull();
    expect(deriveBeneficiaryIdentity('   ')).toBeNull();
  });

  it('clasifica como NIT cuando trae dígito de verificación con guion', () => {
    const id = deriveBeneficiaryIdentity('900123456-7');
    expect(id).toEqual({ tipoId: 'N', numeroId: '9001234567' });
  });

  it('clasifica como NIT cuando empieza por 8 o 9', () => {
    expect(deriveBeneficiaryIdentity('800123456')?.tipoId).toBe('N');
    expect(deriveBeneficiaryIdentity('900987654')?.tipoId).toBe('N');
  });

  it('clasifica como NIT cuando tiene 10+ dígitos', () => {
    expect(deriveBeneficiaryIdentity('1234567890')?.tipoId).toBe('N');
  });

  it('clasifica como cédula un documento corto que no aparenta NIT', () => {
    const id = deriveBeneficiaryIdentity('52123456');
    expect(id).toEqual({ tipoId: 'C', numeroId: '52123456' });
  });

  it('conserva solo los dígitos en numeroId', () => {
    expect(deriveBeneficiaryIdentity('CC 52.123.456')?.numeroId).toBe('52123456');
  });
});
