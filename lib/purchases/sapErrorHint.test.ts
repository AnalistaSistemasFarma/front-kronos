import { describe, expect, it } from 'vitest';
import { sapErrorHint, sapErrorText } from './sapErrorHint';

describe('sapErrorHint', () => {
  it('reconoce el periodo contable bloqueado (reglas de SAPSEND)', () => {
    expect(sapErrorHint('Posting period locked; specify an alternative date')).toMatch(/periodo contable/);
    expect(sapErrorHint('Período de contabilización bloqueado')).toMatch(/periodo contable/);
  });
  it('reconoce la falta de TRM', () => {
    expect(sapErrorHint('Update the exchange rate  [ODRF.DocRate]')).toMatch(/TRM/);
    expect(sapErrorHint('Actualizar el tipo de cambio')).toMatch(/TRM/);
  });
  it('reconoce el socio que no es proveedor y el articulo inexistente', () => {
    expect(sapErrorHint("The selected BP is not a vendor  , '900281394'")).toMatch(/no es proveedor/);
    expect(sapErrorHint('Item number is missing')).toMatch(/artículo/);
  });
  it('deja pasar los demás errores sin pista', () => {
    expect(sapErrorHint('Cuenta inválida')).toBeNull();
    expect(sapErrorText('Cuenta inválida')).toBe('Cuenta inválida');
  });
});
