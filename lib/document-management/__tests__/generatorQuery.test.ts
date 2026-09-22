import { describe, it, expect } from 'vitest';
import { buildGeneratorDocumentsWhere } from '../generatorQuery';

// Regresión: el listado del Generador de Documentos debe mostrar SIEMPRE
// todos los documentos "Vigente" -- aclaración definitiva de Nicolás,
// 2026-09-04: "todos los documentos, sean de procedimiento o no, deben
// mostrarse" -- sin importar id_process (null o no) ni id_document_type.
// Regla anterior (2026-09-02 a 2026-09-04, ya retirada): excluía los
// documentos con id_process IS NULL (carga histórica de Fase 1).

describe('buildGeneratorDocumentsWhere', () => {
  it('nunca incluye id_process en el where (ya no filtra por eso)', () => {
    const where = buildGeneratorDocumentsWhere({
      companyId: null,
      readableCompanyIds: [1, 2],
      documentTypeId: null,
    });
    expect(where).not.toHaveProperty('id_process');
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

  it('el filtro current_status "Vigente" es el ÚNICO filtro de estado/proceso, sin importar la combinación de los demás filtros (regresión)', () => {
    const combos: Array<Parameters<typeof buildGeneratorDocumentsWhere>[0]> = [
      { companyId: null, readableCompanyIds: [1], documentTypeId: null },
      { companyId: 3, readableCompanyIds: [1, 3], documentTypeId: 7 },
      { companyId: null, readableCompanyIds: [], documentTypeId: null },
    ];
    for (const combo of combos) {
      const where = buildGeneratorDocumentsWhere(combo);
      expect(where.current_status).toBe('Vigente');
      expect(where).not.toHaveProperty('id_process');
    }
  });
});
