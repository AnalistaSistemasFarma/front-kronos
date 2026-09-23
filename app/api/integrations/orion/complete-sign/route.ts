import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { getOrionConfig } from '@/lib/orion/config';
import {
  getOrionPersonConsent,
  saveOrionPersonConsent,
} from '@/lib/orion/client';
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
    if (fingerprintDataUrl?.startsWith('data:image/') && !acceptedBiometric) {
      return NextResponse.json(
        { error: BIOMETRIC_CONSENT_REQUIRED_MESSAGE },
        { status: 422 }
      );
    }

    // Primera aceptación: persistir en perfil para no pedir por cada documento.
    if (
      (!personHasSigning && body.acceptedTerms === true) ||
      (!personHasBiometric &&
        body.acceptedBiometric === true &&
        fingerprintDataUrl?.startsWith('data:image/'))
    ) {
      const now = new Date().toISOString();
      try {
        await saveOrionPersonConsent(email, {
          ...(!personHasSigning && body.acceptedTerms === true
            ? {
                legalConsentAccepted: true,
                legalConsentKind: 'ELECTRONIC' as const,
                legalConsentVersion: SIGNING_LEGAL_CONSENT_VERSION,
                legalConsentAcceptedAt: now,
              }
            : {}),
          ...(!personHasBiometric &&
          body.acceptedBiometric === true &&
          fingerprintDataUrl?.startsWith('data:image/')
            ? {
                biometricConsentAccepted: true,
                biometricConsentVersion: BIOMETRIC_CONSENT_VERSION,
                biometricConsentAcceptedAt: now,
              }
            : {}),
        });
      } catch {
        /* no bloquear firma; el panel también intenta persistir */
      }
    }

    const identity = normalizeSignerIdentity(
      {
        fullName: typeof body.fullName === 'string' ? body.fullName : '',
        idDocumentType: body.idDocumentType,
        idNumber: typeof body.idNumber === 'string' ? body.idNumber : '',
        companySlug: typeof body.companySlug === 'string' ? body.companySlug : null,
        companyName: typeof body.companyName === 'string' ? body.companyName : null,
        companyNit: typeof body.companyNit === 'string' ? body.companyNit : null,
        jobTitle: typeof body.jobTitle === 'string' ? body.jobTitle : null,
        acceptedTerms: true,
        acceptedBiometric: acceptedBiometric ? true : undefined,
      },
      session.user.name || email
    );

    const result = await withMssqlPool((pool) =>
      finalizeSignerTurn(pool, {
        requestId,
        userId: String(userId),
        userEmail: email,
        fileId,
        signatureDataUrl,
        fingerprintDataUrl,
        identity,
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
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status) || 500
        : 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}
