import { describe, expect, it } from 'vitest';
import {
  BALANCE_COMPANIES,
  getBalanceCompany,
  getEnabledBalanceCompanies,
} from '../companies';
import { getBalancesConfigurationError } from '../adminPool';

describe('configuración de Balances', () => {
  it('habilita Farmalogica, OLP, GSS y Abamia', () => {
    expect(getEnabledBalanceCompanies().map((company) => company.idCompany)).toEqual([1, 3, 8, 9]);
    expect(getBalanceCompany(1)?.enabled).toBe(true);
  });

  it('tiene OLP y GSS configuradas y habilitadas', () => {
    expect(getBalanceCompany(3)).toMatchObject({ enabled: true, slug: 'olp' });
    expect(getBalanceCompany(8)).toMatchObject({ enabled: true, slug: 'gss' });
    expect(getBalanceCompany(9)).toMatchObject({
      enabled: true,
      slug: 'abamia',
      balanceSqlFile: 'abamia-balance.sql',
      acumuladoSqlFile: 'abamia-acumulado.sql',
    });
    expect(BALANCE_COMPANIES).toHaveLength(4);
  });

  it('no tiene configuración para compañías fuera del alcance', () => {
    expect(getBalanceCompany(2)).toBeUndefined();
  });

  it('detecta la configuración de entorno incompleta sin abrir conexión SQL', () => {
    expect(getBalancesConfigurationError({ BALANCES_SQL_SERVER: '192.168.10.7' })).toBe(
      'Faltan variables de entorno: BALANCES_SQL_DB, BALANCES_SQL_USER, BALANCES_SQL_PASS'
    );
  });

  it('acepta cuando están presentes todas las variables requeridas', () => {
    expect(
      getBalancesConfigurationError({
        BALANCES_SQL_SERVER: '192.168.10.7',
        BALANCES_SQL_DB: 'FARMA_IND_PROD',
        BALANCES_SQL_USER: 'balance_test',
        BALANCES_SQL_PASS: 'not-a-real-secret',
      })
    ).toBeNull();
  });
});
