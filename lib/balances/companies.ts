import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Empresas configuradas para el módulo de Balances.
 *
 * Habilitadas: Farmalogica, OLP, GSS y Abamia.
 * Meditrack y Kelab ya tienen SQL (lib/balances/sql/meditrack-*, kelab-*) pero
 * quedan fuera hasta que exista su registro en `company` de KRONOSDB.
 * Ryan sigue fuera porque todavía no existe SQL de balance para ella.
 *
 * `idCompany` coincide con `company.id_company` en KRONOSDB (producción; en
 * KRONOSDB_PRUEBAS los ids 6/7/9 son otras empresas)
 * (1=Farmalogica, 3=OneLatamPharma/OLP, 8=GSS, 9=Abamia).
 */

export interface BalanceCompanyConfig {
  idCompany: number;
  slug: 'farmalogica' | 'olp' | 'gss' | 'meditrack' | 'abamia' | 'kelab';
  displayName: string;
  balanceSqlFile: string;
  acumuladoSqlFile: string;
  /** Interruptor de activación deliberado: nunca se habilita solo por permisos en KRONOSDB. */
  enabled: boolean;
  /** Contexto visible para mantenimiento; no contiene secretos. */
  disabledReason?: string;
}

export const BALANCE_COMPANIES: readonly BalanceCompanyConfig[] = [
  {
    idCompany: 1,
    slug: 'farmalogica',
    displayName: 'Farmalogica',
    balanceSqlFile: 'farmalogica-balance.sql',
    acumuladoSqlFile: 'farmalogica-acumulado.sql',
    enabled: true,
  },
  {
    idCompany: 3,
    slug: 'olp',
    displayName: 'One Latam Pharma',
    balanceSqlFile: 'olp-balance.sql',
    acumuladoSqlFile: 'olp-acumulado.sql',
    enabled: true,
  },
  {
    idCompany: 8,
    slug: 'gss',
    displayName: 'GSS',
    balanceSqlFile: 'gss-balance.sql',
    acumuladoSqlFile: 'gss-acumulado.sql',
    enabled: true,
  },
  {
    idCompany: 6,
    slug: 'meditrack',
    displayName: 'Meditrack',
    balanceSqlFile: 'meditrack-balance.sql',
    acumuladoSqlFile: 'meditrack-acumulado.sql',
    enabled: true,
  },
  {
    idCompany: 7,
    slug: 'abamia',
    displayName: 'Abamia',
    balanceSqlFile: 'abamia-balance.sql',
    acumuladoSqlFile: 'abamia-acumulado.sql',
    enabled: true,
  },
  {
    idCompany: 9,
    slug: 'kelab',
    displayName: 'Kelab',
    balanceSqlFile: 'kelab-balance.sql',
    acumuladoSqlFile: 'kelab-acumulado.sql',
    enabled: true,
  },
];

/** Configuraciones existentes, incluidas las empresas deshabilitadas. */
export function getBalanceCompany(idCompany: number): BalanceCompanyConfig | undefined {
  return BALANCE_COMPANIES.find((c) => c.idCompany === idCompany);
}

/** Única fuente de verdad para las empresas que se pueden ejecutar hoy. */
export function getEnabledBalanceCompanies(): readonly BalanceCompanyConfig[] {
  return BALANCE_COMPANIES.filter((company) => company.enabled);
}

const SQL_DIR = path.join(process.cwd(), 'lib', 'balances', 'sql');

/** Lee (y cachea en memoria del proceso) el texto de un archivo .sql del módulo. */
const sqlCache = new Map<string, string>();
export function readBalanceSql(fileName: string): string {
  const cached = sqlCache.get(fileName);
  if (cached) return cached;
  const full = path.join(SQL_DIR, fileName);
  // fileName siempre viene de BALANCE_COMPANIES (constante del código, nunca input
  // del usuario) — no hay riesgo de path traversal pese al warning del linter.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const text = fs.readFileSync(full, 'utf8');
  sqlCache.set(fileName, text);
  return text;
}
