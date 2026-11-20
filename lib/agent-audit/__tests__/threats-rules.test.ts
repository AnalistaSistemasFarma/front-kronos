import { describe, expect, it } from 'vitest';
import {
  compareThreats,
  compareVersions,
  evaluateCve,
  evaluateItem,
  InventoryValidationError,
  mergeCve,
  parseInventoryInput,
  parseKevEntry,
  parseNvdCve,
  parseVersion,
  severityFromCvss,
  spanishTitle,
  versionInRange,
  type InventoryItem,
  type ThreatCve,
} from '../threats-rules';

const item = (over: Partial<InventoryItem>): InventoryItem => ({
  id: 1,
  product: 'Apache Tomcat',
  vendor: 'Apache',
  version: '8.5.81',
  role: 'Servidor SAP',
  cpe: 'apache:tomcat',
  keywords: null,
  active: true,
  notes: null,
  ...over,
});

const cve = (over: Partial<ThreatCve>): ThreatCve => ({
  cveId: 'CVE-2025-24813',
  titleEn: null,
  description: null,
  cwes: [],
  cvss: 9.8,
  severity: 'critica',
  published: '2025-03-10T00:00:00.000Z',
  modified: null,
  kev: false,
  kevAdded: null,
  kevDue: null,
  kevRansomware: false,
  kevVendor: null,
  kevProduct: null,
  epss: null,
  cpes: [],
  ...over,
});

describe('versions', () => {
  it('parses dotted, underscore and update styles', () => {
    expect(parseVersion('8.5.81')).toEqual([8, 5, 81]);
    expect(parseVersion('1.8.0_341')).toEqual([1, 8, 0, 341]);
    expect(parseVersion('v22.11.0')).toEqual([22, 11, 0]);
    expect(parseVersion('10.0.17763.5329')).toEqual([10, 0, 17763, 5329]);
    expect(parseVersion('9.5p1')).toEqual([9, 5, 1]);
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('desconocida')).toBeNull();
  });
  it('compares numerically, not lexically', () => {
    expect(compareVersions('8.5.81', '8.5.100')).toBe(-1);
    expect(compareVersions('9.0.99', '9.0.99')).toBe(0);
    expect(compareVersions('10.1', '10.1.0')).toBe(0);
    expect(compareVersions('1.8.0_341', '1.8.0.333')).toBe(1);
  });
});

describe('versionInRange', () => {
  it('end excluding / start including', () => {
    const m = { c: 'cpe:2.3:a:apache:tomcat:*:*:*:*:*:*:*:*', si: '8.5.0', ee: '8.5.100' };
    expect(versionInRange('8.5.81', m)).toBe(true);
    expect(versionInRange('8.5.100', m)).toBe(false);
    expect(versionInRange('8.0.53', m)).toBe(false);
  });
  it('end including / start excluding', () => {
    const m = { c: 'cpe:2.3:a:x:y:*:*:*:*:*:*:*:*', se: '1.0', ei: '2.0' };
    expect(versionInRange('1.0', m)).toBe(false);
    expect(versionInRange('2.0', m)).toBe(true);
    expect(versionInRange('2.0.1', m)).toBe(false);
  });
  it('exact version, including Oracle «update» field', () => {
    expect(versionInRange('1.8.0_341', { c: 'cpe:2.3:a:oracle:jdk:1.8.0:update341:*:*:*:*:*:*' })).toBe(true);
    expect(versionInRange('1.8.0_341', { c: 'cpe:2.3:a:oracle:jdk:1.8.0:update351:*:*:*:*:*:*' })).toBe(false);
    expect(versionInRange('10.1.0', { c: 'cpe:2.3:a:apache:tomcat:10.1.0:milestone1:*:*:*:*:*:*' })).toBe(false);
    expect(versionInRange('9.5p1', { c: 'cpe:2.3:a:openbsd:openssh:9.5:p1:*:*:*:*:*:*' })).toBe(true);
    expect(versionInRange('9.5p1', { c: 'cpe:2.3:a:openbsd:openssh:*:*:*:*:*:*:*:*', ee: '9.8' })).toBe(true);
  });
  it('unbounded wildcard cannot be decided', () => {
    expect(versionInRange('8.5.81', { c: 'cpe:2.3:a:apache:tomcat:*:*:*:*:*:*:*:*' })).toBeNull();
  });
});

describe('evaluateItem / evaluateCve', () => {
  const tomcat24813 = cve({
    cpes: [
      { c: 'cpe:2.3:a:apache:tomcat:*:*:*:*:*:*:*:*', ee: '9.0.99' },
      { c: 'cpe:2.3:a:apache:tomcat:*:*:*:*:*:*:*:*', si: '10.1.1', ee: '10.1.35' },
    ],
  });
  it('«Nos afecta» when the version is inside a range', () => {
    expect(evaluateItem(tomcat24813, item({})).status).toBe('afecta');
  });
  it('«No aplica» when outside every range', () => {
    expect(evaluateItem(tomcat24813, item({ version: '9.0.100' })).status).toBe('no_aplica');
  });
  it('«Revisar» when the version is unknown', () => {
    expect(evaluateItem(tomcat24813, item({ version: null })).status).toBe('revisar');
  });
  it('«Revisar» when our branch is older than every evaluated range (EOL branch)', () => {
    const only9plus = cve({ cpes: [{ c: 'cpe:2.3:a:apache:tomcat:*:*:*:*:*:*:*:*', si: '9.0.0', ee: '9.0.110' }] });
    const r = evaluateItem(only9plus, item({}));
    expect(r.status).toBe('revisar');
    expect(r.reason).toMatch(/anterior/);
  });
  it('KEV product match without CPE data → «Revisar»', () => {
    const kev = cve({ kev: true, kevVendor: 'Apache', kevProduct: 'Tomcat' });
    expect(evaluateItem(kev, item({})).status).toBe('revisar');
    const other = cve({ kev: true, kevVendor: 'Apache', kevProduct: 'ActiveMQ' });
    expect(evaluateItem(other, item({})).status).toBe('no_aplica');
  });
  it('KEV keywords (Windows components)', () => {
    const win = item({ id: 2, product: 'Windows Server 2019', vendor: 'Microsoft', version: '10.0.17763.5329', cpe: 'microsoft:windows_server_2019', keywords: 'windows,win32k' });
    expect(evaluateItem(cve({ kevVendor: 'Microsoft', kevProduct: 'Win32k' }), win).status).toBe('revisar');
    expect(evaluateItem(cve({ kevVendor: 'Microsoft', kevProduct: 'Exchange Server' }), win).status).toBe('no_aplica');
  });
  it('Windows build ranges from NVD', () => {
    const win = item({ id: 2, product: 'Windows Server 2019', vendor: 'Microsoft', version: '10.0.17763.5329', cpe: 'microsoft:windows_server_2019' });
    const c = cve({ cpes: [{ c: 'cpe:2.3:o:microsoft:windows_server_2019:*:*:*:*:*:*:x64:*', ee: '10.0.17763.6893' }] });
    expect(evaluateItem(c, win).status).toBe('afecta');
    expect(evaluateItem(c, { ...win, version: '10.0.17763.7000' }).status).toBe('no_aplica');
  });
  it('several CPE keys (SAP JVM ↔ Oracle Java)', () => {
    const jvm = item({ id: 3, product: 'SAP JVM 8', vendor: 'SAP', version: '1.8.0_341', cpe: 'sap:jvm,oracle:jdk,oracle:jre' });
    const c = cve({ cpes: [{ c: 'cpe:2.3:a:oracle:jre:1.8.0:update341:*:*:*:*:*:*' }] });
    expect(evaluateItem(c, jvm).status).toBe('afecta');
  });
  it('overall status is the worst match; inactive items are ignored', () => {
    const inv = [item({}), item({ id: 2, version: '9.0.100' }), item({ id: 3, version: null, active: false })];
    const ev = evaluateCve(tomcat24813, inv);
    expect(ev.status).toBe('afecta');
    expect(ev.matches.map((m) => m.itemId)).toEqual([1]);
    expect(evaluateCve(tomcat24813, [item({ version: '9.0.100' })]).status).toBe('no_aplica');
  });
});

describe('severity, order and Spanish title', () => {
  it('maps CVSS to severity', () => {
    expect(severityFromCvss(9.8)).toBe('critica');
    expect(severityFromCvss(7)).toBe('alta');
    expect(severityFromCvss(5.3)).toBe('media');
    expect(severityFromCvss(null)).toBe('desconocida');
  });
  it('orders exploited first, then CVSS, then newest', () => {
    const list = [
      cve({ cveId: 'CVE-2026-0001', cvss: 9.8, published: '2026-11-10T00:00:00Z' }),
      cve({ cveId: 'CVE-2026-0002', cvss: 7.5, kev: true, kevAdded: '2026-11-01T00:00:00Z' }),
      cve({ cveId: 'CVE-2026-0003', cvss: 9.8, published: '2026-11-18T00:00:00Z' }),
    ].sort(compareThreats);
    expect(list.map((c) => c.cveId)).toEqual(['CVE-2026-0002', 'CVE-2026-0003', 'CVE-2026-0001']);
  });
  it('builds a short Spanish title from the CWE and product', () => {
    expect(spanishTitle(cve({ cwes: ['CWE-44', 'CWE-502'], kevVendor: 'Apache', kevProduct: 'Tomcat' }))).toBe('Equivalencia de rutas en Apache Tomcat');
    expect(spanishTitle(cve({ description: 'allows remote code execution', cpes: [{ c: 'cpe:2.3:a:sap:netweaver:*:*:*:*:*:*:*:*' }] }))).toBe(
      'Ejecución remota de código en Sap Netweaver',
    );
  });
});

describe('feed parsing', () => {
  it('parses a KEV entry', () => {
    const k = parseKevEntry({
      cveID: 'CVE-2025-24813', vendorProject: 'Apache', product: 'Tomcat', vulnerabilityName: 'Apache Tomcat Path Equivalence Vulnerability',
      dateAdded: '2025-04-01', dueDate: '2025-04-22', knownRansomwareCampaignUse: 'Known', shortDescription: 'x', cwes: ['CWE-44'],
    });
    expect(k).toMatchObject({ cveId: 'CVE-2025-24813', kev: true, kevRansomware: true, kevProduct: 'Tomcat', kevAdded: '2025-04-01T00:00:00.000Z' });
    expect(parseKevEntry({ cveID: 'nope' })).toBeNull();
  });
  it('parses an NVD record and merges it with KEV', () => {
    const n = parseNvdCve({
      id: 'CVE-2025-24813',
      published: '2025-03-10T17:15:35.067',
      lastModified: '2025-10-01T00:00:00.000',
      descriptions: [{ lang: 'en', value: 'Path Equivalence in Tomcat' }],
      metrics: { cvssMetricV31: [{ type: 'Primary', cvssData: { baseScore: 9.8 } }] },
      weaknesses: [{ description: [{ value: 'CWE-44' }, { value: 'NVD-CWE-noinfo' }] }],
      configurations: [{ nodes: [{ cpeMatch: [{ vulnerable: true, criteria: 'cpe:2.3:a:apache:tomcat:*:*:*:*:*:*:*:*', versionEndExcluding: '9.0.99' }, { vulnerable: false, criteria: 'cpe:2.3:o:x:y:*' }] }] }],
      cisaExploitAdd: '2025-04-01',
    })!;
    expect(n.cvss).toBe(9.8);
    expect(n.severity).toBe('critica');
    expect(n.cwes).toEqual(['CWE-44']);
    expect(n.cpes).toEqual([{ c: 'cpe:2.3:a:apache:tomcat:*:*:*:*:*:*:*:*', ee: '9.0.99' }]);
    expect(n.published).toBe('2025-03-10T17:15:35.067Z');
    const merged = mergeCve(parseKevEntry({ cveID: 'CVE-2025-24813', vendorProject: 'Apache', product: 'Tomcat', knownRansomwareCampaignUse: 'Known' })!, n);
    expect(merged).toMatchObject({ kev: true, kevRansomware: true, kevProduct: 'Tomcat', cvss: 9.8, severity: 'critica' });
  });
});

describe('inventory input', () => {
  it('accepts a valid item and normalizes the CPE keys', () => {
    expect(parseInventoryInput({ product: 'Apache Tomcat', vendor: 'Apache', role: 'Servidor SAP', cpe: 'Apache:Tomcat', version: '8.5.81' })).toMatchObject({
      cpe: 'apache:tomcat',
      active: true,
    });
  });
  it('rejects IPs and malformed CPE keys', () => {
    expect(() => parseInventoryInput({ product: 'X', vendor: 'Y', role: 'Servidor 192.168.10.7', cpe: 'a:b' })).toThrow(InventoryValidationError);
    expect(() => parseInventoryInput({ product: 'X', vendor: 'Y', role: 'Servidor SAP', cpe: 'tomcat' })).toThrow(InventoryValidationError);
  });
});
