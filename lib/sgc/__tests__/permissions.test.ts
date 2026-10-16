import { describe, expect, it } from 'vitest';
import {
  SGC_BASE_URL,
  SGC_SUBPROCESS_URLS,
  describeSgcPermissionMarker,
  isSgcPermissionMarkerSubprocess,
  sgcPermissionFromUrl,
} from '../constants';
import { hasSgcPermission, resolveSgcAccess, type SgcGrantRow } from '../permissions';

// Cada título lleva el ID del requisito entre corchetes: el reporte JUnit de CI
// se usa para armar la matriz de trazabilidad requisito → prueba → resultado.

const OLP = { idCompany: 3, companyName: 'ONELATAMPHARMA' };
const FARMA = { idCompany: 1, companyName: 'FARMALOGICA S.A.' };

function grant(url: string, company = OLP): SgcGrantRow {
  return { subprocessUrl: url, ...company };
}

describe('SGC · constantes del módulo', () => {
  it('[SGC-REQ-001] el módulo vive en su propia ruta aislada /process/sgc-documental', () => {
    expect(SGC_BASE_URL).toBe('/process/sgc-documental');
    for (const url of Object.values(SGC_SUBPROCESS_URLS)) {
      expect(url.startsWith(SGC_BASE_URL)).toBe(true);
    }
  });

  it('[SGC-REQ-002] reconoce cada subproceso-permiso por su URL, sin importar mayúsculas ni "/" final', () => {
    expect(sgcPermissionFromUrl('/process/sgc-documental')).toBe('lectura');
    expect(sgcPermissionFromUrl('/PROCESS/SGC-DOCUMENTAL/GESTION/')).toBe('gestion');
    expect(sgcPermissionFromUrl(' /process/sgc-documental/calidad ')).toBe('calidad');
    expect(sgcPermissionFromUrl('/process/sgc-documental/flujos')).toBe('flujos');
  });

  it('[SGC-REQ-002] no confunde URLs ajenas al módulo (incluido el módulo documental retirado)', () => {
    expect(sgcPermissionFromUrl('/process/document-management')).toBeNull();
    expect(sgcPermissionFromUrl('/process/sgc-documental/otra-cosa')).toBeNull();
    expect(sgcPermissionFromUrl(null)).toBeNull();
    expect(sgcPermissionFromUrl(undefined)).toBeNull();
  });

  it('[SGC-REQ-003] solo la entrada de lectura es tarjeta del menú; los demás son marcadores de permiso', () => {
    expect(isSgcPermissionMarkerSubprocess({ subprocess_url: SGC_SUBPROCESS_URLS.lectura })).toBe(false);
    expect(isSgcPermissionMarkerSubprocess({ subprocess_url: SGC_SUBPROCESS_URLS.gestion })).toBe(true);
    expect(isSgcPermissionMarkerSubprocess({ subprocess_url: SGC_SUBPROCESS_URLS.calidad })).toBe(true);
    expect(isSgcPermissionMarkerSubprocess({ subprocess_url: SGC_SUBPROCESS_URLS.flujos })).toBe(true);
    expect(isSgcPermissionMarkerSubprocess({ subprocess_url: '/process/balances' })).toBe(false);
    expect(isSgcPermissionMarkerSubprocess({})).toBe(false);
  });

  it('[SGC-REQ-003] cada marcador tiene su descripción para administración de usuarios', () => {
    expect(describeSgcPermissionMarker(SGC_SUBPROCESS_URLS.gestion)).toMatch(/^Permiso SGC:/);
    expect(describeSgcPermissionMarker(SGC_SUBPROCESS_URLS.calidad)).toMatch(/Calidad/);
    expect(describeSgcPermissionMarker(SGC_SUBPROCESS_URLS.flujos)).toMatch(/flujos validados/);
    expect(describeSgcPermissionMarker(SGC_SUBPROCESS_URLS.lectura)).toBeNull();
    expect(describeSgcPermissionMarker('/process/balances')).toBeNull();
  });
});

describe('SGC · reglas de acceso por empresa', () => {
  it('[SGC-REQ-004] sin empresa activa no hay acceso aunque exista el permiso (fail-closed)', () => {
    expect(resolveSgcAccess([grant(SGC_SUBPROCESS_URLS.lectura)], [])).toEqual([]);
  });

  it('[SGC-REQ-004] un permiso en una empresa NO activada no abre esa empresa', () => {
    const access = resolveSgcAccess(
      [grant(SGC_SUBPROCESS_URLS.lectura), grant(SGC_SUBPROCESS_URLS.gestion, FARMA)],
      [3]
    );
    expect(access.map((a) => a.idCompany)).toEqual([3]);
    expect(hasSgcPermission(access, 1, 'lectura')).toBe(false);
    expect(hasSgcPermission(access, 1, 'gestion')).toBe(false);
  });

  it('[SGC-REQ-005] el permiso de lectura da solo lectura', () => {
    const [olp] = resolveSgcAccess([grant(SGC_SUBPROCESS_URLS.lectura)], [3]);
    expect(olp).toEqual({
      idCompany: 3,
      companyName: 'ONELATAMPHARMA',
      canRead: true,
      canManage: false,
      canQuality: false,
      canAdminFlows: false,
    });
  });

  it('[SGC-REQ-005] gestión, calidad y flujos implican lectura, cada uno por separado', () => {
    for (const perm of ['gestion', 'calidad', 'flujos'] as const) {
      const access = resolveSgcAccess([grant(SGC_SUBPROCESS_URLS[perm])], [3]);
      expect(hasSgcPermission(access, 3, 'lectura')).toBe(true);
      expect(hasSgcPermission(access, 3, perm)).toBe(true);
    }
  });

  it('[SGC-REQ-005] los permisos no se contagian entre sí', () => {
    const access = resolveSgcAccess([grant(SGC_SUBPROCESS_URLS.gestion)], [3]);
    expect(hasSgcPermission(access, 3, 'calidad')).toBe(false);
    expect(hasSgcPermission(access, 3, 'flujos')).toBe(false);
  });

  it('[SGC-REQ-005] ignora filas de subprocesos que no son del SGC', () => {
    const access = resolveSgcAccess(
      [grant('/process/document-management'), grant('/process/balances')],
      [3]
    );
    expect(access).toEqual([]);
  });

  it('[SGC-REQ-006] multiempresa: resuelve cada empresa activa por separado y en orden alfabético', () => {
    const access = resolveSgcAccess(
      [
        grant(SGC_SUBPROCESS_URLS.lectura, OLP),
        grant(SGC_SUBPROCESS_URLS.flujos, OLP),
        grant(SGC_SUBPROCESS_URLS.calidad, FARMA),
      ],
      new Set([1, 3])
    );
    expect(access.map((a) => a.companyName)).toEqual(['FARMALOGICA S.A.', 'ONELATAMPHARMA']);
    expect(hasSgcPermission(access, 3, 'flujos')).toBe(true);
    expect(hasSgcPermission(access, 3, 'calidad')).toBe(false);
    expect(hasSgcPermission(access, 1, 'calidad')).toBe(true);
  });

  it('[SGC-REQ-006] consultar una empresa sin acceso devuelve false', () => {
    expect(hasSgcPermission([], 3, 'lectura')).toBe(false);
  });
});
