import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { getOrionConfig } from '@/lib/orion/config';
import {
  getOrionPersonConsent,
  saveOrionPersonConsent,
} from '@/lib/orion/client';
import { orionErrorResponse } from '@/lib/orion/httpError';
import { finalizeSignerTurn } from '@/lib/orion/service';
import { normalizeSignerIdentity } from '@/lib/orion/signerIdentity';
import {
  BIOMETRIC_CONSENT_REQUIRED_MESSAGE,
  BIOMETRIC_CONSENT_VERSION,
  SIGNING_LEGAL_CONSENT_REQUIRED_MESSAGE,
  SIGNING_LEGAL_CONSENT_VERSION,
} from '@/lib/orion/signingLegalConsent';

/**
 * Confirma la firma del firmante actual: sincroniza Orion, cierra su tarea
 * y abre la del siguiente firmante en la secuencia.
 * POST /api/integrations/orion/complete-sign
 *
 * Consentimiento legal/biométrico: a nivel PERSONA (no por documento).
 * Si el usuario ya aceptó en Orion (user-consent), no se exige checkbox otra vez.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    const userId = session?.user?.id;
    if (!email || !userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const cfg = getOrionConfig();
    if (!cfg.enabled) {
      return NextResponse.json(
        { error: 'Integración Orion no configurada en el servidor' },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    const fileId = body.fileId ? String(body.fileId).trim() : null;
    const signatureDataUrl =
      typeof body.signatureDataUrl === 'string' ? body.signatureDataUrl.trim() : null;
    const fingerprintDataUrl =
      typeof body.fingerprintDataUrl === 'string' ? body.fingerprintDataUrl.trim() : null;
    // Turno con huella: nueva imagen o la registrada en "Mi huella" de Orion.
    const providesFingerprint = body.requireFingerprint === true;
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }

    // Consentimiento guardado en el perfil Orion (abarca a la persona).
    let personHasSigning = false;
    let personHasBiometric = false;
    try {
      const consentRes = await getOrionPersonConsent(email);
      if (consentRes.ok && consentRes.data) {
        personHasSigning = Boolean(consentRes.data.hasSigningLegalConsent);
        personHasBiometric = Boolean(consentRes.data.hasBiometricConsent);
      }
    } catch {
      /* si falla la consulta, exigir checkbox de esta sesión */
    }

    const acceptedTerms = body.acceptedTerms === true || personHasSigning;
    const acceptedBiometric = body.acceptedBiometric === true || personHasBiometric;
    if (!acceptedTerms) {
      return NextResponse.json(
        { error: SIGNING_LEGAL_CONSENT_REQUIRED_MESSAGE },
        { status: 422 }
      );
    }
    if (providesFingerprint && !acceptedBiometric) {
      return NextResponse.json(
        { error: BIOMETRIC_CONSENT_REQUIRED_MESSAGE },
        { status: 422 }
      );
    }

    // Primera aceptación: persistir en perfil sin bloquear accept-sign.
    if (
      (!personHasSigning && body.acceptedTerms === true) ||
      (!personHasBiometric && body.acceptedBiometric === true && providesFingerprint)
    ) {
      const now = new Date().toISOString();
      void saveOrionPersonConsent(email, {
        ...(!personHasSigning && body.acceptedTerms === true
          ? {
              legalConsentAccepted: true,
              legalConsentKind: 'ELECTRONIC' as const,
              legalConsentVersion: SIGNING_LEGAL_CONSENT_VERSION,
              legalConsentAcceptedAt: now,
            }
          : {}),
        ...(!personHasBiometric && body.acceptedBiometric === true && providesFingerprint
          ? {
              biometricConsentAccepted: true,
              biometricConsentVersion: BIOMETRIC_CONSENT_VERSION,
              biometricConsentAcceptedAt: now,
            }
          : {}),
      }).catch(() => {
        /* no bloquear firma; el panel también intenta persistir */
      });
    }

    // Identidad: Orion es la fuente. Solo se reenvía lo que el usuario completó
    // porque faltaba en su perfil Orion (Orion ignora lo que ya tiene).
    const hasIdentityFields =
      typeof body.fullName === 'string' && body.fullName.trim().length > 0;
    const identity = hasIdentityFields
      ? normalizeSignerIdentity(
          {
            fullName: body.fullName,
            idDocumentType: body.idDocumentType,
            idNumber: typeof body.idNumber === 'string' ? body.idNumber : '',
            companyName: typeof body.companyName === 'string' ? body.companyName : null,
            companyNit: typeof body.companyNit === 'string' ? body.companyNit : null,
            jobTitle: typeof body.jobTitle === 'string' ? body.jobTitle : null,
            acceptedTerms: true,
            acceptedBiometric: acceptedBiometric ? true : undefined,
          },
          session.user.name || email
        )
      : { acceptedTerms: true, acceptedBiometric: acceptedBiometric ? true : undefined };

    const result = await withMssqlPool((pool) =>
      finalizeSignerTurn(pool, {
        requestId,
        userId: String(userId),
        userEmail: email,
        fileId,
        signatureDataUrl,
        fingerprintDataUrl,
        identity,
        personConsent: {
          hasSigningLegalConsent: personHasSigning || acceptedTerms,
          hasBiometricConsent: personHasBiometric || acceptedBiometric,
        },
      })
    );

    return NextResponse.json(
      {
        success: true,
        state: result.state,
        documents: result.bag.documents,
        fileId: result.fileId,
        signerCompleted: result.signerCompleted,
        tasksUpdated: result.tasksUpdated,
        requestClosed: result.requestClosed,
        signerTasksClosed: result.signerTasksClosed,
        signerTasksOpened: result.signerTasksOpened,
        currentSignerEmail: result.currentSignerEmail,
        message: result.signerCompleted
          ? 'Documento firmado correctamente.'
          : 'No se pudo confirmar la firma. Intente de nuevo.',
      },
      { status: 200 }
    );
  } catch (err) {
    return orionErrorResponse(err);
  }
}
