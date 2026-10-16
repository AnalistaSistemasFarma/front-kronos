import { FirmaImagenError, sanearFirmaPng } from './png';

/**
 * «MI FIRMA» en GSS Firma (el maestro de firmas compartido de SynerLink, que
 * vive en Orión): cada persona registra SU firma, dibujada o subida como
 * imagen de su firma manuscrita, y queda guardada para reutilizarla.
 *
 * Reglas (Nicolás, 2026-10-14):
 *   - Solo la PROPIA: el correo sale de la SESIÓN, nunca del cuerpo.
 *   - Solo después de REAUTENTICARSE con la contraseña de SynerLink (la ruta
 *     o el flujo de firma la verifican antes de llamar aquí).
 *   - La imagen se valida y se RECODIFICA en el servidor (lib/firma-gss/png.ts).
 *   - Queda una entrada de AUDITORÍA en user_audit_log (sin la imagen; con su
 *     huella SHA-256, el método, el origen y la IP).
 *
 * NO toca el SGC: el SGC tiene su propio maestro de firmas (sgc_signature_master)
 * y su interruptor «firma propia» (company_config.self_signature_enabled), que
 * siguen exactamente igual. Ver el PR.
 */

export const FIRMA_GSS_METODOS = ['drawn', 'uploaded'] as const;
export type FirmaGssMetodo = (typeof FIRMA_GSS_METODOS)[number];
export const FIRMA_GSS_AUDIT_ACTION = 'GSS_FIRMA_REGISTRADA';

export interface FirmaNuevaInput {
  imagen: string;
  metodo: FirmaGssMetodo;
}

/** Lee la firma nueva opcional de un cuerpo JSON ({ imagen, metodo }). null si no viene. */
export function parseFirmaNueva(raw: unknown): FirmaNuevaInput | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new FirmaImagenError('Firma nueva no válida.');
  const r = raw as Record<string, unknown>;
  if (typeof r.imagen !== 'string' || !r.imagen) throw new FirmaImagenError('Falta la imagen de la firma.');
  const metodo = r.metodo === 'uploaded' ? 'uploaded' : r.metodo === 'drawn' ? 'drawn' : null;
  if (!metodo) throw new FirmaImagenError('Indique si la firma fue dibujada o subida como imagen.');
  return { imagen: r.imagen, metodo };
}

export interface FirmaGssDeps {
  /** Guarda en GSS Firma (Orión). */
  guardar: (email: string, dataUrl: string, metodo: FirmaGssMetodo) => Promise<{ ok: boolean; error?: string }>;
  /** Escribe la auditoría. */
  auditar: (row: { user_id: string; action: string; performed_by: string; details: string }) => Promise<unknown>;
}

export interface RegistroFirmaGss {
  idUser: string;
  email: string;
  firma: FirmaNuevaInput;
  origen: 'perfil' | 'bitacora-proceso';
  ip: string | null;
  userAgent?: string | null;
}

export interface FirmaGssResultado {
  dataUrl: string;
  sha256: string;
  guardada: boolean;
  error?: string;
}

/**
 * Sanea la imagen y la registra en GSS Firma con su auditoría. La imagen
 * saneada se devuelve aunque GSS Firma no responda (`guardada: false`), para
 * que quien llama decida (la bitácora firma igual con esa imagen y avisa).
 */
export async function registrarFirmaGss(deps: FirmaGssDeps, input: RegistroFirmaGss): Promise<FirmaGssResultado> {
  const limpia = sanearFirmaPng(input.firma.imagen);
  let guardada = false;
  let error: string | undefined;
  try {
    const r = await deps.guardar(input.email, limpia.dataUrl, input.firma.metodo);
    guardada = r.ok;
    if (!r.ok) error = r.error || 'GSS Firma no guardó la firma.';
  } catch (e) {
    error = e instanceof Error ? e.message : 'GSS Firma no respondió.';
  }
  await deps.auditar({
    user_id: input.idUser,
    action: FIRMA_GSS_AUDIT_ACTION,
    performed_by: input.email,
    details: JSON.stringify({
      metodo: input.firma.metodo,
      origen: input.origen,
      sha256: limpia.sha256,
      ancho: limpia.width,
      alto: limpia.height,
      bytes: limpia.bytes,
      guardadaEnGssFirma: guardada,
      ip: input.ip,
      userAgent: input.userAgent ? input.userAgent.slice(0, 200) : null,
    }),
  });
  return { dataUrl: limpia.dataUrl, sha256: limpia.sha256, guardada, ...(error ? { error: error.slice(0, 300) } : {}) };
}
