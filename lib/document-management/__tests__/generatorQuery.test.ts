import { describe, it, expect } from 'vitest';
import { buildGeneratorDocumentsWhere } from '../generatorQuery';

// Regresión: el listado del Generador de Documentos debe excluir SIEMPRE los
// documentos sin proceso (carga histórica de Fase 1), pedido de Nicolás
// 2026-09-02. Documentos SIN proceso no deben aparecer; documentos CON
// proceso sí.

describe('buildGeneratorDocumentsWhere', () => {
  it('siempre excluye documentos sin proceso (id_process: { not: null })', () => {
    const where = buildGeneratorDocumentsWhere({
      companyId: null,
      readableCompanyIds: [1, 2],
      documentTypeId: null,
    });
    expect(where.id_process).toEqual({ not: null });
  });

  it('siempre filtra por estado "Vigente"', () => {
    const where = buildGeneratorDocumentsWhere({
      companyId: null,
      readableCompanyIds: [1],
      documentTypeId: null,
    });
    expect(where.current_status).toBe('Vigente');
  });

  it('filtra por una empresa específica cuando se pasa companyId', () => {
    const where = buildGeneratorDocumentsWhere({
      companyId: 5,
      readableCompanyIds: [1, 2, 5],
      documentTypeId: null,
    });
    expect(where.id_company).toBe(5);
  });

  it('filtra por todas las empresas legibles cuando no se pasa companyId', () => {
    const where = buildGeneratorDocumentsWhere({
      companyId: null,
      readableCompanyIds: [1, 2, 5],
      documentTypeId: null,
    });
    expect(where.id_company).toEqual({ in: [1, 2, 5] });
  });

  it('agrega el filtro de tipo de documento cuando se pasa', () => {
    const where = buildGeneratorDocumentsWhere({
      companyId: null,
      readableCompanyIds: [1],
      documentTypeId: 9,
    });
    expect(where.id_document_type).toBe(9);
  });

  it('deja id_document_type sin definir cuando no se filtra por tipo', () => {
    const where = buildGeneratorDocumentsWhere({
      companyId: null,
      readableCompanyIds: [1],
      documentTypeId: null,
    });
    expect(where.id_document_type).toBeUndefined();
  });

  it('el filtro id_process NUNCA se puede omitir sin importar la combinación de los demás filtros (regresión)', () => {
    const combos: Array<Parameters<typeof buildGeneratorDocumentsWhere>[0]> = [
      { companyId: null, readableCompanyIds: [1], documentTypeId: null },
      { companyId: 3, readableCompanyIds: [1, 3], documentTypeId: 7 },
      { companyId: null, readableCompanyIds: [], documentTypeId: null },
    ];
    for (const combo of combos) {
      expect(buildGeneratorDocumentsWhere(combo).id_process).toEqual({ not: null });
    }
  });
});
