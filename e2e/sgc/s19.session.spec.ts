import { expect, test } from '@playwright/test';
import { OLP } from './flujo-v7';

/**
 * SGC documental · SPRINT 19 CON SESIÓN, contra PRUEBAS (KRONOSDB_PRUEBAS):
 * el Generador de documentos SOLO para documentos sin codificación (R34).
 *   - Las fuentes posibles de una plantilla son vigentes de tipos marcados
 *     como «plantilla guía»; los demás (codificados) no aparecen.
 *   - Un documento de un tipo codificado no sirve de origen (409 con el motivo).
 * El recorrido completo (marcar el tipo con motivo, proponer, aprobar, generar
 * el registro GEN-… sin código documental) está en la prueba de integración
 * con SQL Server (tests/integration/sgc/generador.integration.test.ts).
 */
test.describe('SGC · Sprint 19 (con sesión)', () => {
  test('[SGC-REQ-179] las fuentes del Generador son solo plantillas guía; un documento codificado se rechaza', async ({ page }) => {
    const res = await page.request.get(`/api/sgc/generator/source?company=${OLP}&vista=fuentes`);
    test.skip(res.status() !== 200, 'El Generador está apagado en PRUEBAS o la sesión no configura plantillas.');
    const { guideTypes, documents } = (await res.json()) as { guideTypes: string[]; documents: { idDocument: number; documentType: string }[] };
    expect(Array.isArray(guideTypes)).toBe(true);
    for (const d of documents) expect(guideTypes).toContain(d.documentType);
    const docs = await page.request.get(`/api/sgc/documents?company=${OLP}`);
    test.skip(docs.status() !== 200, 'Sin listado de documentos en PRUEBAS.');
    const all = ((await docs.json()) as { documents: { idDocument: number }[] }).documents;
    const guide = new Set(documents.map((d) => d.idDocument));
    const coded = all.find((d) => !guide.has(d.idDocument));
    test.skip(!coded, 'Todos los documentos vigentes de PRUEBAS son plantillas guía.');
    const src = await page.request.get(`/api/sgc/generator/source?company=${OLP}&documento=${coded!.idDocument}`);
    expect([404, 409]).toContain(src.status());
    if (src.status() === 409) expect(((await src.json()) as { error: string }).error).toMatch(/sin codificación|VIGENTE/);
  });
});
