/**
 * AGENT AUDIT → VULNERABILITIES → «Lo más reciente y crítico» (global threats) — PURE pieces.
 *
 * Request from Nicolás Rivera (2026-11-20): besides the OSV scan of our own dependencies, show the most
 * recent and most critical vulnerabilities worldwide (CISA KEV + NVD) and tell whether the THIRD-PARTY
 * software we run (SAP Business One, Tomcat, SAP JVM, SQL Server, IIS, Windows Server, Node.js, …) is affected.
 *
 * No DB and no `server-only`: used by the API, the sync job, the page and the unit tests.
 */

export type Severity = 'critica' | 'alta' | 'media' | 'baja' | 'desconocida';
export const SEVERITY_LABELS: Record<Severity, string> = {
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
  desconocida: 'Sin CVSS',
};
export const SEVERITY_ORDER: Severity[] = ['critica', 'alta', 'media', 'baja', 'desconocida'];

/** «Nos afecta» (version inside an affected range), «Revisar» (product matches, version unknown/ambiguous), «No aplica». */
export type MatchStatus = 'afecta' | 'revisar' | 'no_aplica';
export const MATCH_LABELS: Record<MatchStatus, string> = { afecta: 'Nos afecta', revisar: 'Revisar', no_aplica: 'No aplica' };
const MATCH_RANK: Record<MatchStatus, number> = { afecta: 2, revisar: 1, no_aplica: 0 };

/** One vulnerable CPE criterion from NVD `configurations` (compacted). */
export interface CpeMatch {
  /** cpe:2.3:part:vendor:product:version:update:… */
  c: string;
  si?: string; // versionStartIncluding
  se?: string; // versionStartExcluding
  ei?: string; // versionEndIncluding
  ee?: string; // versionEndExcluding
}

export interface InventoryItem {
  id: number;
  product: string;
  vendor: string;
  version: string | null;
  role: string;
  /** Comma-separated `vendor:product` CPE keys, e.g. «apache:tomcat» or «sap:jvm,oracle:jdk,oracle:jre». */
  cpe: string;
  /** Comma-separated extra keywords to match CISA KEV product names (KEV has no CPE), e.g. «windows,win32k». */
  keywords: string | null;
  active: boolean;
  notes: string | null;
}

export interface ThreatCve {
  cveId: string;
  titleEn: string | null;
  description: string | null;
  cwes: string[];
  cvss: number | null;
  severity: Severity;
  published: string | null;
  modified: string | null;
  kev: boolean;
  kevAdded: string | null;
  kevDue: string | null;
  kevRansomware: boolean;
  kevVendor: string | null;
  kevProduct: string | null;
  epss: number | null;
  cpes: CpeMatch[];
}

export interface ItemMatch {
  itemId: number;
  product: string;
  version: string | null;
  role: string;
  status: MatchStatus;
  reason: string;
}

export interface CveEvaluation {
  status: MatchStatus;
  matches: ItemMatch[];
}

/** One row of the «Lo más reciente y crítico» table (API → page). */
export interface ThreatRowDto {
  cveId: string;
  title: string;
  titleEn: string | null;
  description: string | null;
  product: string | null;
  cvss: number | null;
  severity: Severity;
  published: string | null;
  kev: boolean;
  kevAdded: string | null;
  kevDue: string | null;
  kevRansomware: boolean;
  epss: number | null;
  refDate: string | null;
  evaluation: CveEvaluation;
}

/* ------------------------------------------------------------------ versions */

/** «1.8.0_341» → [1,8,0,341]; «9.5p1» → [9,5,1]; «8.5.81» → [8,5,81]. Null if no digits. */
export function parseVersion(v: string | null | undefined): number[] | null {
  if (!v) return null;
  const parts = String(v).split(/[^0-9]+/).filter((p) => p !== '');
  if (!parts.length) return null;
  return parts.map((p) => Number(p));
}

/** Numeric, segment-by-segment comparison; missing segments count as 0. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a) ?? [];
  const y = parseVersion(b) ?? [];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export interface ParsedCpe {
  part: string;
  vendor: string;
  product: string;
  version: string;
  update: string;
}

export function parseCpe(criteria: string): ParsedCpe | null {
  const p = criteria.split(':');
  if (p.length < 6 || p[0] !== 'cpe' || p[1] !== '2.3') return null;
  return { part: p[2], vendor: p[3], product: p[4], version: p[5] ?? '*', update: p[6] ?? '*' };
}

/** Version string of a CPE criterion, folding Oracle-style «update341» into «1.8.0.341». */
function cpeExactVersion(c: ParsedCpe): string | null {
  if (c.version === '*' || c.version === '-' || c.version === '') return null;
  const upd = /^(?:update_?|p)(\d+)$/i.exec(c.update);
  return upd ? `${c.version}.${upd[1]}` : c.version;
}

/**
 * Is `version` inside the range of this criterion?
 *   true  → inside the range (or equals the exact version)
 *   false → outside
 *   null  → cannot tell (criterion is «any version» with no bounds, or unparseable)
 */
export function versionInRange(version: string, m: CpeMatch): boolean | null {
  const c = parseCpe(m.c);
  if (!c || !parseVersion(version)) return null;
  const exact = cpeExactVersion(c);
  const hasBounds = Boolean(m.si || m.se || m.ei || m.ee);
  if (exact && !hasBounds) {
    // Pre-releases («milestone1», «rc1», «beta») never equal a GA install.
    if (c.update !== '*' && c.update !== '-' && !/^(?:update_?|p)\d+$/i.test(c.update)) return false;
    return compareVersions(version, exact) === 0;
  }
  if (!hasBounds) return null;
  if (m.si && compareVersions(version, m.si) < 0) return false;
  if (m.se && compareVersions(version, m.se) <= 0) return false;
  if (m.ei && compareVersions(version, m.ei) > 0) return false;
  if (m.ee && compareVersions(version, m.ee) >= 0) return false;
  return true;
}

/** Lowest lower bound across the criteria (to detect an older, out-of-support branch the vendor did not evaluate). */
function lowestLowerBound(ms: CpeMatch[]): string | null {
  let low: string | null = null;
  for (const m of ms) {
    const c = parseCpe(m.c);
    const lb = m.si ?? m.se ?? (c && !m.ei && !m.ee ? cpeExactVersion(c) : null);
    if (!lb) return null; // some criterion has no lower bound → older versions are covered by it
    if (!low || compareVersions(lb, low) < 0) low = lb;
  }
  return low;
}

/* ------------------------------------------------------------------ matching */

const norm = (s: string | null | undefined) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_()]/g, ' ')
    .replace(/[^a-z0-9.+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function cpeKeys(item: Pick<InventoryItem, 'cpe'>): { vendor: string; product: string }[] {
  return String(item.cpe ?? '')
    .split(/[,;\s]+/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .map((k) => {
      const [vendor, product] = k.split(':');
      return { vendor: vendor ?? '', product: product ?? '' };
    })
    .filter((k) => k.vendor && k.product);
}

function kevMatchesItem(cve: ThreatCve, item: InventoryItem): boolean {
  if (!cve.kevVendor && !cve.kevProduct) return false;
  const kv = norm(cve.kevVendor);
  const kp = norm(cve.kevProduct);
  const keys = cpeKeys(item);
  const vendors = new Set([norm(item.vendor), ...keys.map((k) => norm(k.vendor))].filter(Boolean));
  const vendorOk = [...vendors].some((v) => v === kv || kv.startsWith(`${v} `) || v.startsWith(`${kv} `));
  if (!vendorOk) return false;
  const names = [
    norm(item.product),
    ...keys.map((k) => norm(k.product)),
    ...String(item.keywords ?? '')
      .split(',')
      .map(norm),
  ].filter((n) => n.length >= 3);
  return names.some((n) => kp === n || kp.includes(n) || (n.includes(kp) && kp.length >= 4));
}

/** Evaluates one CVE against one inventory item. */
export function evaluateItem(cve: ThreatCve, item: InventoryItem): ItemMatch {
  const base = { itemId: item.id, product: item.product, version: item.version, role: item.role };
  const keys = cpeKeys(item);
  const relevant = cve.cpes.filter((m) => {
    const c = parseCpe(m.c);
    return c && keys.some((k) => k.vendor === c.vendor && k.product === c.product);
  });

  if (relevant.length) {
    if (!item.version || !parseVersion(item.version))
      return { ...base, status: 'revisar', reason: 'El producto coincide, pero no tenemos la versión instalada.' };
    const results = relevant.map((m) => versionInRange(item.version!, m));
    if (results.some((r) => r === true))
      return { ...base, status: 'afecta', reason: `La versión ${item.version} está en el rango afectado.` };
    if (results.some((r) => r === null))
      return { ...base, status: 'revisar', reason: 'El producto coincide, pero el fabricante no publicó rangos de versión.' };
    const low = lowestLowerBound(relevant);
    if (low && compareVersions(item.version, low) < 0)
      return {
        ...base,
        status: 'revisar',
        reason: `Nuestra versión ${item.version} es anterior a las evaluadas (desde ${low}): rama posiblemente sin soporte, confirmar con el fabricante.`,
      };
    return { ...base, status: 'no_aplica', reason: `La versión ${item.version} está fuera del rango afectado.` };
  }

  if (kevMatchesItem(cve, item)) {
    return {
      ...base,
      status: 'revisar',
      reason: cve.cpes.length
        ? 'CISA lo reporta para este producto, pero NVD no lista nuestra edición: confirmar con el fabricante.'
        : 'CISA lo reporta para este producto y aún no hay rangos de versión en NVD.',
    };
  }
  return { ...base, status: 'no_aplica', reason: '' };
}

/** Evaluates one CVE against the whole (active) inventory. */
export function evaluateCve(cve: ThreatCve, inventory: InventoryItem[]): CveEvaluation {
  const matches = inventory
    .filter((i) => i.active)
    .map((i) => evaluateItem(cve, i))
    .filter((m) => m.status !== 'no_aplica')
    .sort((a, b) => MATCH_RANK[b.status] - MATCH_RANK[a.status]);
  return { status: matches[0]?.status ?? 'no_aplica', matches };
}

/* ------------------------------------------------------------------ severity, order, text */

export function severityFromCvss(score: number | null | undefined): Severity {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'desconocida';
  if (score >= 9) return 'critica';
  if (score >= 7) return 'alta';
  if (score >= 4) return 'media';
  if (score > 0) return 'baja';
  return 'desconocida';
}

/** Reference date of a CVE for «recent»: the later of NVD publication and KEV addition. */
export function referenceDate(c: Pick<ThreatCve, 'published' | 'kevAdded'>): string | null {
  const a = c.published ?? '';
  const b = c.kevAdded ?? '';
  return (a > b ? a : b) || null;
}

/** Default order: exploited first, then CVSS desc, then newest. */
export function compareThreats(a: ThreatCve, b: ThreatCve): number {
  if (a.kev !== b.kev) return a.kev ? -1 : 1;
  const sa = a.cvss ?? -1;
  const sb = b.cvss ?? -1;
  if (sa !== sb) return sb - sa;
  return String(referenceDate(b) ?? '').localeCompare(String(referenceDate(a) ?? ''));
}

/** Short Spanish names for the most common weaknesses (CWE). */
const CWE_ES: Record<string, string> = {
  'CWE-20': 'Validación de entrada indebida',
  'CWE-22': 'Recorrido de rutas (path traversal)',
  'CWE-44': 'Equivalencia de rutas',
  'CWE-77': 'Inyección de comandos',
  'CWE-78': 'Inyección de comandos del sistema operativo',
  'CWE-79': 'Cross-site scripting (XSS)',
  'CWE-89': 'Inyección SQL',
  'CWE-94': 'Inyección de código',
  'CWE-95': 'Inyección de código (eval)',
  'CWE-116': 'Codificación o escape indebido de la salida',
  'CWE-119': 'Corrupción de memoria',
  'CWE-120': 'Desbordamiento de búfer',
  'CWE-121': 'Desbordamiento de pila',
  'CWE-122': 'Desbordamiento de montículo (heap)',
  'CWE-125': 'Lectura fuera de límites',
  'CWE-190': 'Desbordamiento de entero',
  'CWE-200': 'Exposición de información sensible',
  'CWE-269': 'Gestión indebida de privilegios',
  'CWE-276': 'Permisos por defecto incorrectos',
  'CWE-284': 'Control de acceso indebido',
  'CWE-285': 'Autorización indebida',
  'CWE-287': 'Autenticación indebida',
  'CWE-288': 'Omisión de autenticación por ruta alterna',
  'CWE-290': 'Omisión de autenticación por suplantación',
  'CWE-306': 'Falta de autenticación en una función crítica',
  'CWE-311': 'Datos sensibles sin cifrar',
  'CWE-352': 'Falsificación de solicitudes (CSRF)',
  'CWE-362': 'Condición de carrera',
  'CWE-400': 'Consumo de recursos sin control (denegación de servicio)',
  'CWE-416': 'Uso de memoria liberada (use-after-free)',
  'CWE-434': 'Carga de archivos peligrosos sin restricción',
  'CWE-476': 'Desreferencia de puntero nulo',
  'CWE-502': 'Deserialización de datos no confiables',
  'CWE-611': 'Entidades externas XML (XXE)',
  'CWE-639': 'Omisión de autorización por clave controlada por el usuario',
  'CWE-668': 'Exposición de un recurso a la esfera equivocada',
  'CWE-693': 'Falla del mecanismo de protección',
  'CWE-732': 'Permisos incorrectos en un recurso crítico',
  'CWE-770': 'Asignación de recursos sin límites',
  'CWE-787': 'Escritura fuera de límites',
  'CWE-798': 'Credenciales incrustadas en el código',
  'CWE-843': 'Confusión de tipos',
  'CWE-862': 'Falta de autorización',
  'CWE-863': 'Autorización incorrecta',
  'CWE-918': 'Falsificación de solicitudes del lado del servidor (SSRF)',
  'CWE-1321': 'Contaminación de prototipos',
};

/** Keyword fallbacks when the CWE is unknown («NVD-CWE-noinfo»). */
const KEYWORDS_ES: [RegExp, string][] = [
  [/remote code execution|execute arbitrary code|arbitrary code execution/i, 'Ejecución remota de código'],
  [/privilege escalation|elevation of privilege|escalate privileges/i, 'Escalamiento de privilegios'],
  [/sql injection/i, 'Inyección SQL'],
  [/command injection/i, 'Inyección de comandos'],
  [/authentication bypass|bypass authentication/i, 'Omisión de autenticación'],
  [/cross-site scripting|xss/i, 'Cross-site scripting (XSS)'],
  [/path traversal|directory traversal/i, 'Recorrido de rutas (path traversal)'],
  [/deserializ/i, 'Deserialización de datos no confiables'],
  [/denial of service|\bdos\b/i, 'Denegación de servicio'],
  [/information disclosure|disclose information|sensitive information/i, 'Exposición de información sensible'],
  [/use[- ]after[- ]free/i, 'Uso de memoria liberada (use-after-free)'],
  [/out-of-bounds write|buffer overflow|heap overflow/i, 'Corrupción de memoria'],
  [/security feature bypass/i, 'Omisión de una función de seguridad'],
  [/spoofing/i, 'Suplantación'],
];

/** Display name of the affected product: KEV product, else the first CPE product. */
export function productName(c: Pick<ThreatCve, 'kevVendor' | 'kevProduct' | 'cpes'>): string | null {
  if (c.kevProduct) return [c.kevVendor, c.kevProduct].filter(Boolean).join(' ');
  for (const m of c.cpes) {
    const p = parseCpe(m.c);
    if (p) return `${p.vendor} ${p.product}`.replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());
  }
  return null;
}

/** Short Spanish title: «<type of weakness> en <product>». Falls back to a generic sentence. */
export function spanishTitle(c: Pick<ThreatCve, 'cwes' | 'titleEn' | 'description' | 'kevVendor' | 'kevProduct' | 'cpes'>): string {
  const type =
    c.cwes.map((w) => CWE_ES[w.toUpperCase()]).find(Boolean) ??
    KEYWORDS_ES.find(([re]) => re.test(`${c.titleEn ?? ''} ${c.description ?? ''}`))?.[1] ??
    'Vulnerabilidad';
  const product = productName(c);
  return product ? `${type} en ${product}` : type;
}

export const nvdLink = (cveId: string) => `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cveId)}`;

/* ------------------------------------------------------------------ feed parsing */

const CVE_ID = /^CVE-\d{4}-\d{4,7}$/;
export const isCveId = (v: unknown): v is string => typeof v === 'string' && CVE_ID.test(v);

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const isoDate = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  const s = /Z$|[+-]\d\d:\d\d$/.test(v) || v.length <= 10 ? v : `${v}Z`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export const MAX_CPES_PER_CVE = 300;

/** CISA KEV catalog entry → partial ThreatCve (no CVSS; NVD enriches it). */
export function parseKevEntry(e: unknown): Partial<ThreatCve> & { cveId: string } | null {
  const x = (e ?? {}) as Record<string, unknown>;
  if (!isCveId(x.cveID)) return null;
  return {
    cveId: x.cveID,
    titleEn: clean(x.vulnerabilityName, 300),
    description: clean(x.shortDescription, 2000),
    cwes: Array.isArray(x.cwes) ? x.cwes.filter((w): w is string => typeof w === 'string').slice(0, 10) : [],
    kev: true,
    kevAdded: isoDate(x.dateAdded),
    kevDue: isoDate(x.dueDate),
    kevRansomware: String(x.knownRansomwareCampaignUse ?? '').toLowerCase() === 'known',
    kevVendor: clean(x.vendorProject, 150),
    kevProduct: clean(x.product, 200),
  };
}

/** NVD CVE API 2.0 `vulnerabilities[].cve` → partial ThreatCve. */
export function parseNvdCve(raw: unknown): Partial<ThreatCve> & { cveId: string } | null {
  const c = (raw ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!isCveId(c.id)) return null;
  const metrics = c.metrics ?? {};
  const metric =
    [...(metrics.cvssMetricV31 ?? []), ...(metrics.cvssMetricV30 ?? []), ...(metrics.cvssMetricV40 ?? [])].sort(
      (a: { type?: string }, b: { type?: string }) => (a.type === 'Primary' ? -1 : 0) - (b.type === 'Primary' ? -1 : 0),
    )[0] ?? null;
  const score = Number(metric?.cvssData?.baseScore);
  const cvss = Number.isFinite(score) ? score : null;
  const desc = (c.descriptions ?? []).find((d: { lang?: string }) => d.lang === 'en')?.value;
  const cwes = new Set<string>();
  for (const w of c.weaknesses ?? []) for (const d of w.description ?? []) if (/^CWE-\d+$/.test(d.value)) cwes.add(d.value);
  const cpes: CpeMatch[] = [];
  for (const conf of c.configurations ?? [])
    for (const node of conf.nodes ?? [])
      for (const m of node.cpeMatch ?? []) {
        if (!m.vulnerable || typeof m.criteria !== 'string' || cpes.length >= MAX_CPES_PER_CVE) continue;
        const cm: CpeMatch = { c: m.criteria };
        if (m.versionStartIncluding) cm.si = String(m.versionStartIncluding);
        if (m.versionStartExcluding) cm.se = String(m.versionStartExcluding);
        if (m.versionEndIncluding) cm.ei = String(m.versionEndIncluding);
        if (m.versionEndExcluding) cm.ee = String(m.versionEndExcluding);
        cpes.push(cm);
      }
  const out: Partial<ThreatCve> & { cveId: string } = {
    cveId: c.id,
    description: clean(desc, 2000),
    cwes: [...cwes].slice(0, 10),
    cvss,
    severity: severityFromCvss(cvss),
    published: isoDate(c.published),
    modified: isoDate(c.lastModified),
    cpes,
  };
  if (c.cisaExploitAdd) {
    out.kev = true;
    out.kevAdded = isoDate(c.cisaExploitAdd);
    out.kevDue = isoDate(c.cisaActionDue);
    out.titleEn = clean(c.cisaVulnerabilityName, 300);
  }
  return out;
}

/** Merges partial records (KEV, NVD, EPSS) of the same CVE; later non-empty values win, KEV flags are sticky. */
export function mergeCve(a: Partial<ThreatCve> | undefined, b: Partial<ThreatCve> & { cveId: string }): ThreatCve {
  const pick = <K extends keyof ThreatCve>(k: K): ThreatCve[K] | undefined => {
    const v = b[k];
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) return a?.[k] as ThreatCve[K] | undefined;
    return v as ThreatCve[K];
  };
  const cvss = (pick('cvss') as number | null | undefined) ?? null;
  return {
    cveId: b.cveId,
    titleEn: pick('titleEn') ?? null,
    description: pick('description') ?? null,
    cwes: pick('cwes') ?? [],
    cvss,
    severity: severityFromCvss(cvss),
    published: pick('published') ?? null,
    modified: pick('modified') ?? null,
    kev: Boolean(a?.kev || b.kev),
    kevAdded: pick('kevAdded') ?? null,
    kevDue: pick('kevDue') ?? null,
    kevRansomware: Boolean(a?.kevRansomware || b.kevRansomware),
    kevVendor: pick('kevVendor') ?? null,
    kevProduct: pick('kevProduct') ?? null,
    epss: pick('epss') ?? null,
    cpes: pick('cpes') ?? [],
  };
}

/* ------------------------------------------------------------------ inventory validation */

export class InventoryValidationError extends Error {}

const CPE_PART = /^[a-z0-9_.-]{1,100}$/;
const validCpeKeys = (v: string) =>
  v
    .split(/[,; ]/)
    .filter(Boolean)
    .every((k) => {
      const p = k.split(':');
      return p.length === 2 && CPE_PART.test(p[0]) && CPE_PART.test(p[1]);
    });
/** No IPs or hostnames in the inventory: roles only («Servidor SAP», «Servidor de aplicaciones»). */
const looksLikeIp = (v: string) =>
  v.split(/[^0-9.]/).some((t) => {
    const p = t.split('.');
    return p.length === 4 && p.every((x) => x.length >= 1 && x.length <= 3);
  });

export type InventoryInput = Omit<InventoryItem, 'id'>;

export function parseInventoryInput(body: unknown): InventoryInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const product = clean(b.product, 150);
  const vendor = clean(b.vendor, 100);
  const role = clean(b.role, 100);
  const cpe = (clean(b.cpe, 400) ?? '').toLowerCase();
  if (!product) throw new InventoryValidationError('Falta el producto.');
  if (!vendor) throw new InventoryValidationError('Falta el fabricante.');
  if (!role) throw new InventoryValidationError('Falta el rol del equipo (por ejemplo «Servidor SAP»).');
  if (!cpe || !validCpeKeys(cpe))
    throw new InventoryValidationError('La clave CPE debe ser «fabricante:producto» (varias separadas por coma), por ejemplo «apache:tomcat».');
  const version = clean(b.version, 80);
  const keywords = clean(b.keywords, 300);
  const notes = clean(b.notes, 500);
  for (const v of [product, vendor, role, keywords, notes]) // not the version: «10.00.191.091» is a valid SAP version
    if (v && looksLikeIp(v)) throw new InventoryValidationError('No registre direcciones IP en el inventario; use el rol del equipo.');
  return { product, vendor, role, cpe, version, keywords, notes, active: b.active !== false };
}
