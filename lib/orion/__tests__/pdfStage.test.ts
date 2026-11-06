import { describe, expect, it } from 'vitest';
import { pdfStageOf } from '../pdfStage';

const base = { status: null, orionDocumentId: null, signersTotal: 0, signersDone: 0, readyForSigning: null };

describe('pdfStageOf', () => {
  it('sin validar: etapa 1 (Validación PDF)', () => {
    expect(pdfStageOf(base)).toEqual({ stage: 0, tone: 'normal', note: null });
    expect(pdfStageOf({ ...base, readyForSigning: false }).stage).toBe(0);
  });

  it('validado o sin validación: etapa 2 (Ubicar firmas)', () => {
    expect(pdfStageOf({ ...base, readyForSigning: true }).stage).toBe(1);
  });

  it('borrador con firmantes asignados aún no está en firmas', () => {
    const info = pdfStageOf({
      ...base,
      status: 'BORRADOR',
      orionDocumentId: 'doc-1',
      signersTotal: 2,
      readyForSigning: true,
    });
    expect(info.stage).toBe(1);
  });

  it('enviado a firmar: etapa 3 con cuántas firmas van', () => {
    for (const status of ['PENDIENTE_FIRMA', 'EN_PROCESO']) {
      expect(pdfStageOf({ ...base, status, orionDocumentId: 'doc-1', signersTotal: 3, signersDone: 1 })).toEqual({
        stage: 2,
        tone: 'normal',
        note: 'Etapa 3 de 3 · Firmas (1 de 3)',
      });
    }
  });

  it('en Orion sin estado guardado cuenta como en proceso (igual que la insignia)', () => {
    expect(pdfStageOf({ ...base, orionDocumentId: 'doc-1', signersTotal: 2 }).stage).toBe(2);
  });

  it('firmado: todo listo, por estado o porque firmaron todos', () => {
    expect(pdfStageOf({ ...base, status: 'FIRMADO', signersTotal: 1, signersDone: 1 }).stage).toBe(3);
    expect(pdfStageOf({ ...base, status: 'EN_PROCESO', signersTotal: 2, signersDone: 2 }).stage).toBe(3);
  });

  it('rechazado no se ve como firmas en curso', () => {
    expect(pdfStageOf({ ...base, status: 'RECHAZADO', signersTotal: 2, signersDone: 1 })).toEqual({
      stage: 2,
      tone: 'rejected',
      note: 'Rechazado: no se firmará',
    });
  });

  it('devuelto vuelve a la validación del PDF', () => {
    expect(pdfStageOf({ ...base, status: 'DEVUELTO', signersTotal: 2, readyForSigning: true })).toEqual({
      stage: 0,
      tone: 'returned',
      note: 'Devuelto para corrección',
    });
  });

  it('no se pasa de la cuenta si llegan datos raros', () => {
    expect(pdfStageOf({ ...base, status: 'EN_PROCESO', signersTotal: 2, signersDone: 5 }).stage).toBe(3);
    expect(pdfStageOf({ ...base, status: 'EN_PROCESO', orionDocumentId: 'x', signersTotal: 2, signersDone: -1 }).note).toBe(
      'Etapa 3 de 3 · Firmas (0 de 2)'
    );
  });
});
