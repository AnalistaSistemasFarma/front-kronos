import { describe, expect, it } from 'vitest';
import { draftPlainText, getDraftHtmlError, safeImageSrc, sanitizeDraftHtml, SGC_DRAFT_MAX_IMAGE_CHARS } from '../draft/html';
import { SGC_PROCEDURE_TEMPLATE_HTML, SGC_PROCEDURE_TEMPLATE_SECTIONS } from '../draft/template';
import { isCompanyEmail, parseCompanyDomains, resolveReaders, type SgcScopeDirectory, type SgcScopeEntry } from '../dissemination/scope';
import { presentInteraction } from '../interactionView';
import { areaOf, documentsOfArea, groupByAreaAndType, SGC_NO_AREA_ID, type SgcMasterItem } from '../masterList';
import { hasChangeHistoryToken } from '../pdf/institutional';
import { TINY_PNG_B64 } from './fixtures/images';

/**
 * Correcciones de Calidad OLP (reunión 2026-10-02): reglas puras de la
 * divulgación por empresa, la navegación por área → tipo, la plantilla
 * institucional, las imágenes incrustadas (logo) y el «No entendí».
 */

describe('SGC · correcciones · divulgación solo a la empresa del documento', () => {
  const dir = (domains: string[] | null): SgcScopeDirectory => ({
    eligible: new Set(['ana@onelatampharma.com', 'nicolas.rivera@gsslatam.com', 'luis@onelatampharma.com', 'externo@farmalogica.com']),
    companyMembers: ['ana@onelatampharma.com', 'nicolas.rivera@gsslatam.com', 'luis@onelatampharma.com', 'externo@farmalogica.com'],
    departmentMembers: new Map([[3, ['luis@onelatampharma.com', 'nicolas.rivera@gsslatam.com', 'sin.acceso@onelatampharma.com']]]),
    cargoMembers: new Map([[7, ['nicolas.rivera@gsslatam.com']]]),
    companyDomains: domains,
  });
  const empresa: SgcScopeEntry = { kind: 'empresa', idDepartment: null, idCargo: null, userEmail: null };

  it('[SGC-REQ-098] «toda la empresa» solo incluye correos de la empresa del documento: nunca GSS ni otra empresa del grupo', () => {
    const r = resolveReaders([empresa], dir(['onelatampharma.com']));
    expect(r.readers.map((x) => x.email)).toEqual(['ana@onelatampharma.com', 'luis@onelatampharma.com']);
    expect(r.outsideCompany.map((x) => x.email)).toEqual(['externo@farmalogica.com', 'nicolas.rivera@gsslatam.com']);
    expect(r.withoutAccess).toEqual([]);
  });

  it('[SGC-REQ-098] departamento y cargo también se filtran por empresa; a otra persona solo se le asigna lectura eligiéndola a mano como «Persona»', () => {
    const r = resolveReaders(
      [
        { kind: 'departamento', idDepartment: 3, idCargo: null, userEmail: null },
        { kind: 'cargo', idCargo: 7, idDepartment: null, userEmail: null },
        { kind: 'persona', userEmail: 'externo@farmalogica.com', idDepartment: null, idCargo: null },
      ],
      dir(['onelatampharma.com'])
    );
    expect(r.readers.map((x) => x.email)).toEqual(['externo@farmalogica.com', 'luis@onelatampharma.com']);
    expect(r.withoutAccess.map((x) => x.email)).toEqual(['sin.acceso@onelatampharma.com']);
    expect(r.outsideCompany).toEqual([{ email: 'nicolas.rivera@gsslatam.com', sources: ['cargo:7', 'departamento:3'] }]);
  });

  it('[SGC-REQ-098] sin dominios configurados no se filtra (comportamiento anterior); los dominios se normalizan', () => {
    expect(resolveReaders([empresa], dir(null)).readers).toHaveLength(4);
    expect(parseCompanyDomains(' OneLatamPharma.com, @otra.com.co; mal dominio, ,onelatampharma.com')).toEqual(['onelatampharma.com', 'otra.com.co', 'mal', 'dominio'].filter((d) => d.includes('.')));
    expect(parseCompanyDomains('')).toBeNull();
    expect(parseCompanyDomains(null)).toBeNull();
    expect(isCompanyEmail('X@OneLatamPharma.com', ['onelatampharma.com'])).toBe(true);
    expect(isCompanyEmail('x@gsslatam.com', ['onelatampharma.com'])).toBe(false);
    expect(isCompanyEmail('sin-arroba', ['onelatampharma.com'])).toBe(false);
    expect(isCompanyEmail('x@gsslatam.com', [])).toBe(true);
    expect(isCompanyEmail('x@gsslatam.com', null)).toBe(true);
  });
});

describe('SGC · correcciones · navegación por área → tipo documental', () => {
  const item = (id: number, code: string, area: { id: number; name: string } | null, type: { id: number; code: string; name: string; pluralName: string }): SgcMasterItem => ({
    idDocument: id,
    code,
    title: `Documento ${code}`,
    status: 'vigente',
    confidentiality: 'publica',
    versionNumber: 1,
    idVersion: id,
    effectiveDate: '2026-01-01',
    reviewDueDate: '2029-01-01',
    processType: { id: 1, code: 'M', name: 'Misionales', color: 'blue' },
    process: { id: 1, code: 'GC', name: 'Gestión de calidad', department: null },
    area,
    documentType: { ...type, alertMonths: 2 },
  });
  const MA = { id: 1, code: 'MA', name: 'Manual', pluralName: 'Manuales' };
  const PR = { id: 2, code: 'PR', name: 'Procedimiento', pluralName: 'Procedimientos' };
  const IN = { id: 3, code: 'IN', name: 'Instructivo', pluralName: 'Instructivos' };
  const compras = { id: 9, name: 'Compras' };
  const calidad = { id: 3, name: 'Garantía de Calidad' };
  const items = [item(1, 'OLP-CO-PR-010', compras, PR), item(2, 'OLP-CO-PR-002', compras, PR), item(3, 'OLP-CO-MA-001', compras, MA), item(4, 'OLP-GC-IN-001', calidad, IN), item(5, 'OLP-X-PR-001', null, PR)];

  it('[SGC-REQ-101] agrupa por área (alfabético, «sin área» al final) y dentro por tipo documental, con sus conteos', () => {
    const g = groupByAreaAndType(items);
    expect(g.map((a) => [a.name, a.count])).toEqual([
      ['Compras', 3],
      ['Garantía de Calidad', 1],
      ['Sin área asignada', 1],
    ]);
    expect(g[0].types.map((t) => [t.pluralName, t.count])).toEqual([
      ['Manuales', 1],
      ['Procedimientos', 2],
    ]);
    expect(groupByAreaAndType([items[4], items[0]]).map((a) => a.id)).toEqual([9, SGC_NO_AREA_ID]);
    expect(groupByAreaAndType([])).toEqual([]);
  });

  it('[SGC-REQ-101] lista los documentos de un área y tipo en orden natural de código', () => {
    expect(documentsOfArea(items, 9, 2).map((d) => d.code)).toEqual(['OLP-CO-PR-002', 'OLP-CO-PR-010']);
    expect(documentsOfArea(items, 9).map((d) => d.code)).toEqual(['OLP-CO-MA-001', 'OLP-CO-PR-002', 'OLP-CO-PR-010']);
    expect(documentsOfArea(items, SGC_NO_AREA_ID, null).map((d) => d.code)).toEqual(['OLP-X-PR-001']);
    expect(areaOf({ area: undefined })).toEqual({ id: SGC_NO_AREA_ID, name: 'Sin área asignada' });
  });
});

describe('SGC · correcciones · plantilla institucional de procedimiento', () => {
  it('[SGC-REQ-096] la plantilla del editor trae las secciones de la plantilla de Calidad (objetivo a historial de cambios) y las marcas de campos de sistema; sobrevive a la limpieza del HTML', () => {
    const clean = sanitizeDraftHtml(SGC_PROCEDURE_TEMPLATE_HTML);
    for (const s of SGC_PROCEDURE_TEMPLATE_SECTIONS) expect(clean).toContain(s);
    expect(clean).toContain('{{NOMBRE_DOCUMENTO}}');
    expect(hasChangeHistoryToken(clean)).toBe(true);
    expect(getDraftHtmlError(clean)).toBeNull();
    // Orden de las secciones como en la plantilla.
    const positions = SGC_PROCEDURE_TEMPLATE_SECTIONS.map((s) => clean.indexOf(`. ${s}<`));
    expect(positions.every((p, i) => p > 0 && (i === 0 || p > positions[i - 1]))).toBe(true);
  });
});

describe('SGC · correcciones · imágenes incrustadas (el logo ya no se pierde)', () => {
  const png = `data:image/png;base64,${TINY_PNG_B64}`;
  it('[SGC-REQ-103] se conserva la imagen incrustada (PNG/JPEG/GIF) solo con su src; se descartan las externas, SVG, con eventos o demasiado grandes', () => {
    const html = `<p>Logo: <img alt="x" onerror="alert(1)" src="${png}" width="90"></p><p><img src="https://evil/x.png"></p><p><img src='data:image/svg+xml;base64,PHN2Zz4='></p><img src="data:image/jpeg;base64,/9j/4AA=">`;
    const clean = sanitizeDraftHtml(html);
    expect(clean).toContain(`<img src="${png}">`);
    expect(clean).toContain('<img src="data:image/jpeg;base64,/9j/4AA=">');
    expect(clean).not.toMatch(/evil|svg|onerror|alt=|width=/);
    expect(safeImageSrc(`src="data:image/png;base64,${'A'.repeat(SGC_DRAFT_MAX_IMAGE_CHARS + 1)}"`)).toBeNull();
    expect(safeImageSrc('src="data:image/gif;base64,R0lG OD lh"')).toBe('data:image/gif;base64,R0lGODlh');
    expect(draftPlainText(`<p>${'texto '.repeat(5)}<img src="${png}"></p>`)).toBe('texto texto texto texto texto');
  });
});

describe('SGC · correcciones · «No entendí» en el historial', () => {
  it('[SGC-REQ-100] el «No entendí» se lee en el historial de la solicitud con lo que la persona escribió', () => {
    const v = presentInteraction({ id: '1', kind: 'duda', authorEmail: 'lector@onelatampharma.com', author: 'Lector', body: 'No entendí «OLP-GC-PR-007 V1 — Procedimiento».\nEl paso 3 no dice qué formato usar.\nNi quién lo firma.', createdAt: '2026-10-03T15:00:00Z' }, (e) => e);
    expect(v.action).toBe('marcó «No entendí» en la lectura del documento');
    expect(v.note).toBe('No entendí «OLP-GC-PR-007 V1 — Procedimiento».');
    expect(v.observation).toBe('El paso 3 no dice qué formato usar.\nNi quién lo firma.');
    expect(presentInteraction({ id: '2', kind: 'duda', authorEmail: 'x', author: null, body: 'No entendí «X».', createdAt: '2026-10-03T15:00:00Z' }, (e) => e).observation).toBeNull();
  });
});
