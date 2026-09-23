import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { getOrionConfig } from '@/lib/orion/config';
import {
  getOrionPersonConsent,
  saveOrionPersonConsent,
} from '@/lib/orion/client';
import {
  BIOMETRIC_CONSENT_VERSION,
  SIGNING_LEGAL_CONSENT_VERSION,
} from '@/lib/orion/signingLegalConsent';

/**
 * Consentimiento de firma a nivel PERSONA (no por documento).
 * GET  /api/integrations/orion/signing-consent
 * POST /api/integrations/orion/signing-consent
 *   { acceptedTerms?, acceptedBiometric?, legalKind? }
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!getOrionConfig().enabled) {
      return NextResponse.json({ error: 'Integración Orion no configurada' }, { status: 503 });
    }

    const res = await getOrionPersonConsent(email);
    if (!res.ok || !res.data) {
      // Usuario aún no existe en Orion: tratar como sin consentimiento.
      if (res.status === 404) {
        return NextResponse.json({
          email: email.trim().toLowerCase(),
          hasSigningLegalConsent: false,
          hasBiometricConsent: false,
          currentSigningLegalVersion: SIGNING_LEGAL_CONSENT_VERSION,
          currentBiometricVersion: BIOMETRIC_CONSENT_VERSION,
        });
      }
      return NextResponse.json(
        { error: res.error || 'No se pudo consultar el consentimiento' },
        { status: res.status >= 500 ? 503 : 502 }
      );
    }
    return NextResponse.json({ success: true, ...res.data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
    if (!getOrionConfig().enabled) {
      return NextResponse.json({ error: 'Integración Orion no configurada' }, { status: 503 });
    }

    const body = await req.json().catch(() => ({}));
    const acceptedTerms = body.acceptedTerms === true || body.legalConsentAccepted === true;
    const acceptedBiometric =
      body.acceptedBiometric === true || body.biometricConsentAccepted === true;
    if (!acceptedTerms && !acceptedBiometric) {
      return NextResponse.json(
        { error: 'Indique consentimiento de firma y/o biométrico.' },
        { status: 422 }
      );
    }

    const now = new Date().toISOString();
    const res = await saveOrionPersonConsent(email, {
      ...(acceptedTerms
        ? {
            legalConsentAccepted: true,
            legalConsentKind:
              body.legalKind === 'DIGITAL' || body.legalConsentKind === 'DIGITAL'
                ? 'DIGITAL'
                : 'ELECTRONIC',
            legalConsentVersion: SIGNING_LEGAL_CONSENT_VERSION,
            legalConsentAcceptedAt: now,
          }
        : {}),
      ...(acceptedBiometric
        ? {
            biometricConsentAccepted: true,
            biometricConsentVersion: BIOMETRIC_CONSENT_VERSION,
            biometricConsentAcceptedAt: now,
          }
        : {}),
    });

    if (!res.ok || !res.data) {
      return NextResponse.json(
        { error: res.error || 'No se pudo guardar el consentimiento' },
        { status: res.status >= 500 ? 503 : 422 }
      );
    }
    return NextResponse.json({ success: true, ...res.data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 }
    );
  }
}
