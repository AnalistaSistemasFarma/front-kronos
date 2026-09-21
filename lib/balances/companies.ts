import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Empresas habilitadas para el módulo de Balances — Sprint 1.
 *
 * Alcance DELIBERADO: solo las 3 empresas que hoy tiene el job compartido de
 * SQL Agent `Balance_Empresas` / `Balance_Acumulado_Empresas` en el 10.7
 * (Farmalogica, OLP, GSS). Ryan/Abamia/Kelab/Meditrack NO están wireados en
 * ese job (verificado 2026-09-21) — agregarlas es trabajo de Sprint 3, no solo
 * de código: hay que escribir el SQL de balance para cada una desde cero.
 *
 * `idCompany` coincide con `company.id_company` en KRONOSDB (1=Farmalogica,
 * 3=OneLatamPharma/OLP, 8=GSS).
 *
 * El SQL de cada paso se extrajo VERBATIM del job compartido en el 10.7
 * (sp_help_jobstep, 2026-09-21) — se ejecuta tal cual, sin reescribir, para no
 * introducir un bug nuevo respecto al job original.
 */

export interface BalanceCompanyConfig {
  idCompany: number;
  slug: 'farmalogica' | 'olp' | 'gss';
  displayName: string;
  balanceSqlFile: string;
  acumuladoSqlFile: string;
}

export const BALANCE_COMPANIES: BalanceCompanyConfig[] = [
  {
    idCompany: 1,
    slug: 'farmalogica',
    displayName: 'Farmalogica',
    balanceSqlFile: 'farmalogica-balance.sql',
    acumuladoSqlFile: 'farmalogica-acumulado.sql',
  },
  {
    idCompany: 3,
    slug: 'olp',
    displayName: 'One Latam Pharma',
    balanceSqlFile: 'olp-balance.sql',
    acumuladoSqlFile: 'olp-acumulado.sql',
  },
  {
    idCompany: 8,
    slug: 'gss',
    displayName: 'GSS',
    balanceSqlFile: 'gss-balance.sql',
    acumuladoSqlFile: 'gss-acumulado.sql',
  },
];

export function getBalanceCompany(idCompany: number): BalanceCompanyConfig | undefined {
  return BALANCE_COMPANIES.find((c) => c.idCompany === idCompany);
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
