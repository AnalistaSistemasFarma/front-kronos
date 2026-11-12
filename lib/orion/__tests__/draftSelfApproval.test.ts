import { describe, expect, it } from 'vitest';
import {
  applyDraftInternalDecision,
  applyDraftNewVersion,
  applyDraftResendInternal,
  applyDraftSelfApproval,
  applyDraftSubmitInternal,
  createDraftState,
  draftReviewPhase,
  pdfReviewFromDraft,
  pendingDraftValidators,
  type DraftActor,
} from '../draftState';
import { SELF_REVIEW_COMMENT, type OrionReviewValidator } from '../reviewState';

const ela: DraftActor = { userId: 'u-ela', email: 'ela@x.com', name: 'Ela' };
const ana: DraftActor = { userId: 'u-ana', email: 'ana@x.com', name: 'Ana' };
const elaV: OrionReviewValidator = { userId: 'u-ela', email: 'ela@x.com', name: 'Ela', order: 1 };
const anaV: OrionReviewValidator = { userId: 'u-ana', email: 'ana@x.com', name: 'Ana', order: 2 };

function nuevo() {
  return createDraftState({
    fileId: 'f1',
    fileName: 'Contrato.docx',
    actor: ela,
    firstVersion: {
      id: 'a',
      oneDriveItemId: 'item-a',
      fileName: 'Contrato.docx',
      uploadedByEmail: 'ela@x.com',
      createdAt: '2026-11-03T10:00:00.000Z',
    },
  });
}

function enviar(validators: OrionReviewValidator[]) {
  return applyDraftSelfApproval(applyDraftSubmitInternal(nuevo(), { actor: ela, validators }), ela);
}

describe('Word: la preparadora también valida', () => {
  it('única validadora: queda validado internamente y listo para el PDF', () => {
    const s = enviar([elaV]);
    expect(s.status).toBe('VALIDADO_INTERNO');
    expect(s.internalReview?.status).toBe('APROBADO');
    expect(s.internalReview?.approvals[0]).toMatchObject({
      decision: 'APROBADO',
      comment: SELF_REVIEW_COMMENT,
      approvedVersion: 'v0.1',
    });
    expect(pendingDraftValidators(s)).toHaveLength(0);
    // En el PDF ella aparece como validadora aprobada para ubicar su visto bueno.
    expect(pdfReviewFromDraft(s)?.approvals.map((a) => a.email)).toEqual(['ela@x.com']);
  });

  it('con otro validador: solo queda pendiente el otro', () => {
    const s = enviar([elaV, anaV]);
    expect(s.status).toBe('EN_VALIDACION_INTERNA');
    expect(pendingDraftValidators(s).map((a) => a.email)).toEqual(['ana@x.com']);
    const fin = applyDraftInternalDecision(s, { actor: ana, decision: 'approve', baseVersion: 'v0.1' });
    expect(fin.status).toBe('VALIDADO_INTERNO');
  });

  it('tras una corrección, al reenviar su aprobación queda sobre la versión nueva', () => {
    let s = enviar([elaV, anaV]);
    s = applyDraftInternalDecision(s, { actor: ana, decision: 'return', comment: 'Ajustar', baseVersion: 'v0.1' });
    expect(draftReviewPhase(s)).toBe('correccion');
    s = applyDraftNewVersion(s, {
      actor: ela,
      version: {
        id: 'b',
        oneDriveItemId: 'item-b',
        fileName: 'Contrato.docx',
        uploadedByEmail: 'ela@x.com',
        createdAt: '2026-11-03T11:00:00.000Z',
      },
    });
    s = applyDraftSelfApproval(applyDraftResendInternal(s, { actor: ela }), ela);
    expect(pendingDraftValidators(s).map((a) => a.email)).toEqual(['ana@x.com']);
    expect(s.internalReview?.approvals.find((a) => a.email === 'ela@x.com')?.approvedVersion).toBe(s.versionLabel);
  });

  it('si no es validadora no cambia nada', () => {
    const s = applyDraftSubmitInternal(nuevo(), { actor: ela, validators: [anaV] });
    expect(applyDraftSelfApproval(s, ela)).toBe(s);
  });
});
