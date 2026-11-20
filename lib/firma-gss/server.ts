import { prisma } from '../prisma';
import { getOrionConfig } from '../orion/config';
import {
  getOrionPersonConsent,
  getOrionSignerPreview,
  loadOrionUserSignature,
  saveOrionPersonConsent,
  saveOrionUserSignature,
} from '../orion/client';
import { SIGNING_LEGAL_CONSENT_VERSION } from '../orion/signingLegalConsent';
import type { DatosSelloActuales, DatosSelloDeps } from './datosSello';
import type { FirmaGssDeps } from './miFirma';

/**
 * Dependencias REALES de «Mi firma» en GSS Firma: Orión para guardar/leer y
 * user_audit_log (tabla existente) para la auditoría. Sin cambio de esquema.
 */
export function firmaGssDeps(): FirmaGssDeps {
  return {
    guardar: async (email, dataUrl, metodo) => {
      if (!getOrionConfig().enabled) return { ok: false, error: 'GSS Firma no está configurada en este ambiente.' };
      const r = await saveOrionUserSignature(email, dataUrl, metodo);
      const err = (r.data as { error?: string } | null)?.error || r.error;
      return { ok: r.ok, error: r.ok ? undefined : err || 'GSS Firma no guardó la firma.' };
    },
    auditar: (row) => prisma.userAuditLog.create({ data: row }),
  };
}

export interface FirmaGssVista {
  /** false si GSS Firma no está configurada o no respondió. */
  disponible: boolean;
  hasSignature: boolean;
  dataUrl: string | null;
  method: string | null;
}

/**
 * Firma registrada de la persona. Si la persona aún no existe en GSS Firma
 * (USER_NOT_FOUND) cuenta como «sin firma»: al guardar, Orión la crea.
 */
export async function consultarFirmaGss(email: string, timeoutMs = 6000): Promise<FirmaGssVista> {
  const nada: FirmaGssVista = { disponible: false, hasSignature: false, dataUrl: null, method: null };
  if (!getOrionConfig().enabled) return nada;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const r = await Promise.race([loadOrionUserSignature(email).catch(() => null), timeout]);
  if (!r) return nada;
  if (!r.ok) {
    const code = (r.data as { code?: string } | null)?.code;
    if (r.status === 404 || code === 'USER_NOT_FOUND') return { disponible: true, hasSignature: false, dataUrl: null, method: null };
    return nada;
  }
  const dataUrl = r.data?.dataUrl ?? null;
  return { disponible: true, hasSignature: Boolean(dataUrl), dataUrl, method: r.data?.method ?? null };
}

/** Datos del sello y consentimiento actuales en GSS Firma (Orión). */
async function leerDatosSello(email: string): Promise<DatosSelloActuales> {
  const [preview, consent] = await Promise.all([
    getOrionSignerPreview(email).catch(() => null),
    getOrionPersonConsent(email).catch(() => null),
  ]);
  const d = preview?.ok ? preview.data : null;
  return {
    fullName: d?.fullName ?? null,
    idDocumentType: d?.idDocumentType ?? null,
    idNumber: d?.idNumber ?? null,
    jobTitle: d?.jobTitle ?? null,
    hasSigningLegalConsent: Boolean(consent?.ok && consent.data?.hasSigningLegalConsent),
  };
}

/** Dependencias REALES de «Datos del sello»: Orión y user_audit_log. */
export function datosSelloDeps(): DatosSelloDeps {
  return {
    leerFirma: async (email) => {
      const r = await loadOrionUserSignature(email);
      return r.ok ? { dataUrl: r.data?.dataUrl ?? null, method: r.data?.method ?? null } : { dataUrl: null, method: null };
    },
    leerActuales: leerDatosSello,
    guardar: async (email, dataUrl, method, datos) => {
      const r = await saveOrionUserSignature(email, dataUrl, method, datos);
      const err = (r.data as { error?: string } | null)?.error || r.error;
      return { ok: r.ok, error: r.ok ? undefined : err || 'GSS Firma no guardó los datos.' };
    },
    guardarConsentimiento: async (email) => {
      const r = await saveOrionPersonConsent(email, {
        legalConsentAccepted: true,
        legalConsentKind: 'ELECTRONIC',
        legalConsentVersion: SIGNING_LEGAL_CONSENT_VERSION,
        legalConsentAcceptedAt: new Date().toISOString(),
      });
      return { ok: r.ok, error: r.ok ? undefined : r.error || 'GSS Firma no guardó el consentimiento.' };
    },
    auditar: (row) => prisma.userAuditLog.create({ data: row }),
  };
}

export interface DatosSelloVista extends DatosSelloActuales {
  /** false si GSS Firma no está configurada o no respondió. */
  disponible: boolean;
}

/** Datos del sello de la persona de la sesión (para el perfil). */
export async function consultarDatosSello(email: string, timeoutMs = 8000): Promise<DatosSelloVista> {
  const nada: DatosSelloVista = { disponible: false, hasSigningLegalConsent: false };
  if (!getOrionConfig().enabled) return nada;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const r = await Promise.race([leerDatosSello(email).catch(() => null), timeout]);
  return r ? { disponible: true, ...r } : nada;
}
