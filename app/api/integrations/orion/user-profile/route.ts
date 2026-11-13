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
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = String(session?.user?.email || '').trim().toLowerCase();
    if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const enabled = getOrionConfig().enabled;
    const withFingerprint = new URL(req.url).searchParams.get('fingerprint') !== '0';
    // Tope corto: si Orion no responde, igual devolvemos sugerencias de SynerLink
    // para no dejar el modal en «Consultando su perfil…» 15–20 s.
    const orionBudgetMs = 8_000;
    const withBudget = <T,>(p: Promise<T>): Promise<T | null> =>
      Promise.race([
        p.catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), orionBudgetMs)),
      ]);

    const [preview, fingerprint, consent, local] = await Promise.all([
      enabled ? withBudget(getOrionSignerPreview(email)) : Promise.resolve(null),
      enabled && withFingerprint ? withBudget(getOrionUserFingerprint(email)) : Promise.resolve(null),
      enabled ? withBudget(getOrionPersonConsent(email)) : Promise.resolve(null),
      withMssqlPool(async (pool) => {
        const result = await pool
          .request()
          .input('email', sql.NVarChar(255), email)
          .query(`SELECT TOP 1 name, identification FROM [user] WHERE LOWER(LTRIM(RTRIM(email))) = @email`);
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
