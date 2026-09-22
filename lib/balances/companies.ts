import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Empresas configuradas para el módulo de Balances.
 *
 * Solo Farmalogica está habilitada en este momento. Aunque el SQL histórico de
 * OLP y GSS permanece versionado, esas empresas quedan bloqueadas desde el
 * servidor hasta que se complete y valide su configuración operativa propia.
 * Ryan/Abamia/Kelab/Meditrack siguen fuera del módulo porque todavía no existe
 * SQL de balance validado para ellas.
 *
 * `idCompany` coincide con `company.id_company` en KRONOSDB
 * (1=Farmalogica, 3=OneLatamPharma/OLP, 8=GSS).
 */

export interface BalanceCompanyConfig {
  idCompany: number;
  slug: 'farmalogica' | 'olp' | 'gss';
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
    enabled: false,
    disabledReason: 'Pendiente de configuración y validación operativa exclusiva para OLP.',
  },
  {
    idCompany: 8,
    slug: 'gss',
    displayName: 'GSS',
    balanceSqlFile: 'gss-balance.sql',
    acumuladoSqlFile: 'gss-acumulado.sql',
    enabled: false,
    disabledReason: 'Pendiente de configuración y validación operativa exclusiva para GSS.',
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
