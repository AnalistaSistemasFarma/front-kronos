import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '@/lib/mssqlPool';
import { getOrionConfig, getOrionSignatureProfileUrl } from '@/lib/orion/config';
import {
  getOrionFingerprintProfileUrl,
  getOrionPersonConsent,
  getOrionSignerPreview,
  getOrionUserFingerprint,
} from '@/lib/orion/client';

/**
 * GET /api/integrations/orion/user-profile
 * Vista previa de solo lectura del firmante en sesión. Orion es la fuente de rúbrica,
 * nombre, cédula y cargo (`user-signature`), huella (`user-fingerprint`) y
 * consentimientos (`user-consent`). SynerLink solo sugiere lo que falte en Orion.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const email = String(session?.user?.email || '').trim().toLowerCase();
    if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const enabled = getOrionConfig().enabled;
    const [preview, fingerprint, consent, local] = await Promise.all([
      enabled ? getOrionSignerPreview(email).catch(() => null) : Promise.resolve(null),
      enabled ? getOrionUserFingerprint(email).catch(() => null) : Promise.resolve(null),
      enabled ? getOrionPersonConsent(email).catch(() => null) : Promise.resolve(null),
      withMssqlPool(async (pool) => {
        const result = await pool
          .request()
          .input('email', sql.NVarChar(255), email)
          .query(`SELECT TOP 1 name, identification FROM [user] WHERE LOWER(email) = @email`);
        return result.recordset[0] as { name?: string | null; identification?: string | null } | undefined;
      }).catch(() => undefined),
    ]);

    const orion = preview?.ok ? preview.data : null;
    const missingInOrion = (
      [
        ['fullName', orion?.fullName],
        ['idNumber', orion?.idNumber],
        ['jobTitle', orion?.jobTitle],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([key]) => key);

    return NextResponse.json({
      email,
      fullName: orion?.fullName ?? null,
      idDocumentType: orion?.idDocumentType ?? null,
      idNumber: orion?.idNumber ?? null,
      jobTitle: orion?.jobTitle ?? null,
      companyName: orion?.companyName ?? null,
      hasSignature: Boolean(orion?.hasSignature),
      signatureDataUrl: orion?.signatureDataUrl ?? null,
      hasFingerprint: Boolean(fingerprint?.ok && fingerprint.data?.hasFingerprint),
      hasSigningLegalConsent: Boolean(consent?.ok && consent.data?.hasSigningLegalConsent),
      hasBiometricConsent: Boolean(consent?.ok && consent.data?.hasBiometricConsent),
      missingInOrion,
      suggested: {
        fullName: local?.name?.trim() || session?.user?.name || null,
        idNumber: local?.identification?.trim() || null,
      },
      signatureProfileUrl: getOrionSignatureProfileUrl(),
      fingerprintProfileUrl: getOrionFingerprintProfileUrl(),
      source: orion ? 'orion' : 'synerlink',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
