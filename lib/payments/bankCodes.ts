// ---------------------------------------------------------------------------
// Catálogo de códigos de compensación bancaria (ACH Colombia) — 3 dígitos.
//
// El archivo DISFON del Banco de Bogotá identifica al banco del beneficiario con
// el CÓDIGO DE COMPENSACIÓN de ACH Colombia (3 dígitos), no con el nombre. Este
// módulo mapea el código o el nombre del banco que viene de SAP a ese código de
// 3 dígitos.
//
// Es una tabla AMPLIABLE: aquí están los bancos más usados en la operación. Si
// aparece un banco nuevo, se agrega una fila a BANK_CODES con su código oficial
// (verificable en el listado de entidades de ACH Colombia). Si un banco no está
// en la tabla, `resolveBankCode` devuelve null para que la validación lo marque
// en vez de emitir un código incorrecto.
//
// Función PURA: no toca red, SAP ni agrega dependencias.
// ---------------------------------------------------------------------------

/** Una entidad bancaria: su código de compensación y los alias por nombre. */
export interface BankCodeEntry {
  /** Código de compensación ACH Colombia (3 dígitos). */
  code: string;
  /** Nombre canónico del banco. */
  name: string;
  /** Alias / variantes de nombre con que puede llegar desde SAP. */
  aliases: string[];
}

/**
 * Catálogo de bancos. AMPLIABLE: agregue filas nuevas con su código oficial de
 * ACH Colombia. Los `aliases` se comparan normalizados (sin tildes, sin la
 * palabra "banco", minúsculas), así que no hace falta listar cada variante.
 */
export const BANK_CODES: BankCodeEntry[] = [
  { code: '001', name: 'Banco de Bogotá', aliases: ['bogota'] },
  { code: '002', name: 'Banco Popular', aliases: ['popular'] },
  { code: '006', name: 'Itaú', aliases: ['itau', 'corpbanca', 'helm'] },
  { code: '007', name: 'Bancolombia', aliases: ['bancolombia'] },
  { code: '009', name: 'Citibank', aliases: ['citibank', 'citi'] },
  { code: '012', name: 'Banco GNB Sudameris', aliases: ['gnb sudameris', 'sudameris', 'gnb'] },
  { code: '013', name: 'BBVA Colombia', aliases: ['bbva'] },
  { code: '019', name: 'Scotiabank Colpatria', aliases: ['scotiabank colpatria', 'colpatria', 'scotiabank'] },
  { code: '023', name: 'Banco de Occidente', aliases: ['occidente'] },
  { code: '032', name: 'Banco Caja Social', aliases: ['caja social', 'bcsc'] },
  { code: '040', name: 'Banco Agrario', aliases: ['agrario'] },
  { code: '051', name: 'Davivienda', aliases: ['davivienda'] },
  { code: '052', name: 'Banco AV Villas', aliases: ['av villas', 'avvillas'] },
  { code: '053', name: 'Banco W', aliases: ['w'] },
  { code: '059', name: 'Bancamía', aliases: ['bancamia'] },
  { code: '060', name: 'Banco Pichincha', aliases: ['pichincha'] },
  { code: '061', name: 'Bancoomeva', aliases: ['bancoomeva', 'coomeva'] },
  { code: '062', name: 'Banco Falabella', aliases: ['falabella'] },
  { code: '063', name: 'Banco Finandina', aliases: ['finandina'] },
  { code: '065', name: 'Banco Santander', aliases: ['santander'] },
  { code: '066', name: 'Banco Cooperativo Coopcentral', aliases: ['coopcentral', 'cooperativo coopcentral'] },
  { code: '067', name: 'Banco Mundo Mujer', aliases: ['mundo mujer'] },
  { code: '069', name: 'Banco Serfinanza', aliases: ['serfinanza'] },
  { code: '292', name: 'Confiar', aliases: ['confiar'] },
  { code: '507', name: 'Nequi', aliases: ['nequi'] },
  { code: '551', name: 'Daviplata', aliases: ['daviplata'] },
];

/**
 * Normaliza un texto de banco para comparar por nombre: minúsculas, sin tildes,
 * sin la palabra "banco", sin caracteres no alfanuméricos y sin espacios
 * repetidos. Así "BANCO DE BOGOTÁ", "Bogota" y "banco bogota" convergen.
 */
function normalizeBankName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .toLowerCase()
    .replace(/\bbanco\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Índice por código de 3 dígitos (para aceptar el código directamente).
const byCode = new Map<string, string>();
for (const b of BANK_CODES) byCode.set(b.code, b.code);

// Índice por nombre normalizado (canónico + alias).
const byName = new Map<string, string>();
for (const b of BANK_CODES) {
  byName.set(normalizeBankName(b.name), b.code);
  for (const alias of b.aliases) byName.set(normalizeBankName(alias), b.code);
}

/**
 * Resuelve el código de compensación (3 dígitos) a partir de lo que venga de
 * SAP: puede ser YA el código (p. ej. "001", "7", "13") o el nombre/alias del
 * banco (p. ej. "Banco de Bogotá", "BANCOLOMBIA"). Devuelve `null` si no se
 * reconoce, para que la validación lo reporte (nunca inventa un código).
 *
 *  - Si `input` es puramente numérico, se interpreta como código y se rellena a
 *    3 dígitos con ceros a la izquierda (p. ej. "7" -> "007") antes de buscarlo.
 *  - Si es texto, se busca por nombre normalizado (canónico o alias).
 */
export function resolveBankCode(input: string | null | undefined): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // Caso 1: viene un número -> tratarlo como código de compensación.
  if (/^\d+$/.test(raw)) {
    if (raw.length > 3) return null; // no es un código de compensación válido
    const code = raw.padStart(3, '0');
    return byCode.has(code) ? code : null;
  }

  // Caso 2: viene texto -> buscar por nombre / alias normalizado.
  const norm = normalizeBankName(raw);
  return byName.get(norm) ?? null;
}
