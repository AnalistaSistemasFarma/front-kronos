/**
 * Mapeo empresa SynerLink ↔ base SAPSEND en el mismo SQL Server de Kronos.
 *
 * Hallazgo 2026-11-18: en este SQL están SAPSEND* y SBO-COMMON / SLDModel, pero
 * NO las bases de compañía SAP B1 (FARMALOGICA_PROD, etc.): esas viven en el
 * servidor de SAP. Por eso la concurrencia "SAP (SBO)" en este monitor solo
 * refleja lo que haya de SBO-COMMON / programas B1 en ESTE SQL, más el pulso
 * HTTP al Service Layer.
 */

/** @type {Array<{ idCompany: number, companyMatch: RegExp, sapsendDb: string }>} */
export const COMPANY_SAPSEND_DBS = [
  { idCompany: 7, companyMatch: /^ABAMIA$/i, sapsendDb: 'SAPSEND_ABAMIA' },
  { idCompany: 8, companyMatch: /^GSS$/i, sapsendDb: 'SAPSEND_GSS' },
  { idCompany: 9, companyMatch: /^KELAB$/i, sapsendDb: 'SAPSEND_KELAB' },
  { idCompany: 6, companyMatch: /^MEDITRACK$/i, sapsendDb: 'SAPSEND_MEDITRACK' },
  { idCompany: 10, companyMatch: /^ONELATAMONCO$/i, sapsendDb: 'SAPSEND_ONELATAMONCO' },
  { idCompany: 2, companyMatch: /RYAN/i, sapsendDb: 'SAPSEND_RYAN' },
  // Farmalógica / OLP: bases genéricas en este SQL (sin sufijo de empresa).
  { idCompany: 1, companyMatch: /FARMALOGICA/i, sapsendDb: 'SAPSEND' },
  { idCompany: 3, companyMatch: /ONELATAMPHARMA|OLP/i, sapsendDb: 'SAPSEND_02' },
];

export function sapsendDbForCompany(idCompany, companyName) {
  const byId = COMPANY_SAPSEND_DBS.find((r) => r.idCompany === idCompany);
  if (byId) return byId.sapsendDb;
  const byName = COMPANY_SAPSEND_DBS.find((r) => r.companyMatch.test(String(companyName || '')));
  return byName?.sapsendDb ?? null;
}

/** ¿El nombre de programa parece Service Layer / B1 / SAPSEND? */
export function classifyProgram(programName) {
  const p = String(programName || '').toLowerCase();
  if (!p) return 'other';
  if (p.includes('service layer') || p.includes('b1s') || p.includes('sapservice')) return 'serviceLayer';
  if (p.includes('sapsend')) return 'sapsend';
  if (p.includes('sap business one') || p.includes('sap b1') || p.includes('di api')) return 'sapClient';
  if (p.includes('node') || p.includes('kronos') || p.includes('tiberius') || p.includes('tedious')) return 'kronos';
  return 'other';
}
