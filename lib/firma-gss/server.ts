import { prisma } from '../prisma';
import { getOrionConfig } from '../orion/config';
import { loadOrionUserSignature, saveOrionUserSignature } from '../orion/client';
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
