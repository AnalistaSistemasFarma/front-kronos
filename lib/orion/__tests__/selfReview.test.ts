import { describe, expect, it } from 'vitest';
import {
  autoApproveSubmitter,
  buildPendingApprovals,
  currentPendingApproval,
  SELF_REVIEW_COMMENT,
} from '../reviewState';
import type { OrionReviewState } from '../types';

const AT = '2026-11-03T12:00:00.000Z';

function reviewOf(...people: Array<[string, string]>): OrionReviewState {
  return {
    status: 'EN_VALIDACION',
    approvals: buildPendingApprovals(
      people.map(([userId, email], i) => ({ userId, email, name: email, order: i + 1 }))
    ),
    versionLabel: 'v1',
  };
}

describe('autoApproveSubmitter (la preparadora también valida)', () => {
  it('única validadora: queda aprobado para firma sin pasos pendientes', () => {
    const next = autoApproveSubmitter(reviewOf(['7', 'ana@gss.com']), { userId: '7', email: 'ana@gss.com' }, AT);
    expect(next.status).toBe('APROBADO');
    expect(next.approvedAt).toBe(AT);
    expect(next.approvals[0]).toMatchObject({ decision: 'APROBADO', comment: SELF_REVIEW_COMMENT });
    expect(currentPendingApproval(next)).toBeNull();
  });

  it('primera de varias: su paso se aprueba y la tarea va al siguiente', () => {
    const next = autoApproveSubmitter(
      reviewOf(['7', 'ana@gss.com'], ['9', 'luis@gss.com']),
      { userId: '7', email: 'ana@gss.com' },
      AT
    );
    expect(next.status).toBe('EN_VALIDACION');
    expect(currentPendingApproval(next)?.email).toBe('luis@gss.com');
  });

  it('en medio del orden: se salta su paso cuando llegue el turno', () => {
    const next = autoApproveSubmitter(
      reviewOf(['9', 'luis@gss.com'], ['7', 'ana@gss.com'], ['5', 'eva@gss.com']),
      { userId: '7', email: 'ana@gss.com' },
      AT
    );
    expect(currentPendingApproval(next)?.email).toBe('luis@gss.com');
    expect(next.approvals[1].decision).toBe('APROBADO');
    expect(next.approvals[2].decision).toBe('PENDIENTE');
  });

  it('reconoce por correo aunque cambie mayúsculas', () => {
    const next = autoApproveSubmitter(reviewOf(['7', 'ana@gss.com']), { email: 'ANA@gss.com' }, AT);
    expect(next.status).toBe('APROBADO');
  });

  it('si no es validadora no cambia nada', () => {
    const review = reviewOf(['9', 'luis@gss.com']);
    expect(autoApproveSubmitter(review, { userId: '7', email: 'ana@gss.com' }, AT)).toBe(review);
  });
});
