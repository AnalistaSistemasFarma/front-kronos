import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enlaceOsv, esReciente, parsePublicacionVulns, severidadDesdeOsv, VulnValidacionError } from '../vulns-rules';

describe('vulnerabilidades — severidad y fechas', () => {
  it('traduce la severidad de OSV/GHSA', () => {
    expect(severidadDesdeOsv('CRITICAL')).toBe('critica');
    expect(severidadDesdeOsv('high')).toBe('alta');
    expect(severidadDesdeOsv('MODERATE')).toBe('media');
    expect(severidadDesdeOsv('LOW')).toBe('baja');
    expect(severidadDesdeOsv(undefined)).toBe('desconocida');
  });
  it('reciente = últimos 7 días, no futuro', () => {
    const ahora = Date.parse('2026-11-19T12:00:00Z');
    expect(esReciente('2026-11-15T00:00:00Z', 7, ahora)).toBe(true);
    expect(esReciente('2026-11-01T00:00:00Z', 7, ahora)).toBe(false);
    expect(esReciente('2026-12-30T00:00:00Z', 7, ahora)).toBe(false);
    expect(esReciente(null, 7, ahora)).toBe(false);
  });
  it('enlace a osv.dev', () => expect(enlaceOsv('GHSA-2464-fhr4-w9xw')).toBe('https://osv.dev/vulnerability/GHSA-2464-fhr4-w9xw'));
});

describe('vulnerabilidades — publicación del escáner', () => {
  const h = {
    repo: 'AnalistaSistemasFarma/front-kronos', rama: 'main', archivo: 'package-lock.json', ecosistema: 'npm',
    paquete: 'next', version: '15.5.4', directa: true, vulnId: 'GHSA-2464-fhr4-w9xw', alias: 'CVE-2026-1234',
    resumen: 'RCE', severidad: 'critica', publicada: '2026-10-22T15:52:53Z', modificada: '2026-10-23T00:00:00Z',
    versionCorregida: '15.5.28', referencia: 'https://github.com/advisories/GHSA-2464-fhr4-w9xw',
  };
  it('valida y normaliza', () => {
    const p = parsePublicacionVulns({ idRun: 3, repos: 13, paquetes: 3739, resumen: 'x', hallazgos: [h] });
    expect(p.hallazgos[0]).toMatchObject({ paquete: 'next', severidad: 'critica', directa: true });
  });
  it('rechaza datos inválidos o enlaces no https', () => {
    const mal = (c: Record<string, unknown>) => () => parsePublicacionVulns({ idRun: 1, hallazgos: [{ ...h, ...c }] });
    expect(mal({ repo: 'no es repo' })).toThrow(VulnValidacionError);
    expect(mal({ ecosistema: 'maven' })).toThrow(VulnValidacionError);
    expect(mal({ vulnId: '<script>' })).toThrow(VulnValidacionError);
    expect(mal({ paquete: '' })).toThrow(VulnValidacionError);
    expect(() => parsePublicacionVulns({ idRun: 0, hallazgos: [] })).toThrow(VulnValidacionError);
    expect(parsePublicacionVulns({ idRun: 1, hallazgos: [{ ...h, referencia: 'javascript:alert(1)' }] }).hallazgos[0].referencia).toBeNull();
    expect(parsePublicacionVulns({ idRun: 1, hallazgos: [{ ...h, severidad: 'extrema' }] }).hallazgos[0].severidad).toBe('desconocida');
  });
});

describe('vulnerabilidades — scripts SQL', () => {
  const leer = (r: string) => readFileSync(join(process.cwd(), r), 'utf8').replace(/\r\n/g, '\n');
  const bloque = (s: string) => s.slice(s.indexOf('/* BLOQUE-DDL-INICIO */'), s.indexOf('/* BLOQUE-DDL-FIN */'));
  it('PRUEBAS y PROD llevan el mismo DDL y se detienen en otra base', () => {
    const a = leer('prisma/manual/2026-11-19-vulnerabilidades-PRUEBAS.sql');
    const b = leer('prisma/manual/2026-11-19-vulnerabilidades-PROD.sql');
    expect(bloque(a)).toContain('CREATE TABLE [dbo].[agent_vuln_finding]');
    expect(bloque(b)).toBe(bloque(a));
    expect(a).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS'/);
    expect(b).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/);
  });
});
