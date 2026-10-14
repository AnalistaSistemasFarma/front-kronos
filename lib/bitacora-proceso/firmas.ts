import { createHash } from 'node:crypto';
import { SIGNING_LEGAL_CONSENT_REQUIRED_MESSAGE, SIGNING_LEGAL_CONSENT_VERSION } from '../orion/signingLegalConsent';
import { OtError, type OtCompanyAccess } from './rules';

/**
 * FIRMA ELECTRÓNICA de la Bitácora de Proceso — reglas PURAS (probadas con Vitest).
 *
 * Nicolás (2026-10-13): «recuerda que las firmas también son digitales, para eso
 * tenemos firmas ya construidas». Se reutilizan las piezas de SynerLink:
 *   - reautenticación con la contraseña de SynerLink (lib/auth/verifyPassword.ts,
 *     la misma regla del inicio de sesión);
 *   - el consentimiento de firma ELECTRÓNICA de GSS Firma (Ley 527/1999, Decreto
 *     2364/2012; lib/orion/signingLegalConsent.ts), con su versión;
 *   - la firma REGISTRADA de la persona en GSS Firma (Orión) como imagen visible.
 * Lo propio de la bitácora es solo la evidencia (ot_firma, solo inserción):
 * significado, hora del servidor y huella SHA-256 del contenido firmado.
 *
 * Flujo: el SUPERVISOR cierra firmando («Cerró»); después el INSPECTOR de la
 * bitácora verifica firmando («Verificó»). Son personas distintas.
 */
import { OT_FIRMA_SIGNIFICADO, type OtFirmaRol } from './constants';
export { OT_FIRMA_SIGNIFICADO, type OtFirmaRol };
export const OT_FIRMA_AUTH_METHOD = 'contrasena_synerlink';
export const OT_FIRMA_CONSENT_VERSION = SIGNING_LEGAL_CONSENT_VERSION;

export const OT_REAUTH_MAX_FALLOS = 5;
export const OT_REAUTH_VENTANA_MIN = 15;

export interface FirmaInput {
  password: string;
}

/** Cuerpo de una firma: contraseña y aceptación expresa del consentimiento. */
export function parseFirma(body: Record<string, unknown> | null): FirmaInput {
  if (!body) throw new OtError('Se esperaba un JSON con la firma.', 400);
  if (body.acepto !== true) throw new OtError(SIGNING_LEGAL_CONSENT_REQUIRED_MESSAGE, 400);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) throw new OtError('Escriba su contraseña de SynerLink para firmar.', 400);
  if (password.length > 200) throw new OtError('Contraseña no válida.', 400);
  return { password };
}

/** Al abrir: el inspector no puede ser el supervisor que abre (segregación de funciones). */
export function assertInspectorDistinto(inspector: string, supervisor: string): void {
  if (inspector === supervisor) {
    throw new OtError('El inspector debe ser una persona distinta del supervisor que abre la bitácora.', 400);
  }
}

/** Cierre firmado («Cerró»): solo Gestión, bitácora ABIERTA y quien firma no es el inspector. */
export function assertPuedeCerrar(
  orden: { estado: string; inspector: string | null },
  idUser: string,
  access: OtCompanyAccess
): void {
  if (!access.canManage) throw new OtError('Solo el supervisor (Bitácora de Proceso: Gestión) cierra la bitácora.', 403);
  if (orden.estado !== 'ABIERTA') throw new OtError('La bitácora ya está cerrada.', 409);
  if (orden.inspector && orden.inspector === idUser) {
    throw new OtError('El inspector de esta bitácora no puede cerrarla: la cierra el supervisor y él la verifica.', 403);
  }
}

/** Verificación firmada («Verificó»): solo el inspector designado, después del cierre firmado, una vez. */
export function assertPuedeVerificar(
  orden: { estado: string; inspector: string | null },
  firmas: ReadonlyArray<{ rol: string; id_user: string }>,
  idUser: string
): void {
  if (!orden.inspector || orden.inspector !== idUser) {
    throw new OtError('Solo el inspector designado en esta bitácora puede verificarla.', 403);
  }
  if (orden.estado !== 'CERRADA') throw new OtError('La bitácora se verifica después de que el supervisor la cierre.', 409);
  const sup = firmas.find((f) => f.rol === 'SUPERVISOR');
  if (!sup) throw new OtError('Falta la firma de cierre del supervisor.', 409);
  if (sup.id_user === idUser) throw new OtError('Quien cerró la bitácora no puede verificarla.', 403);
  if (firmas.some((f) => f.rol === 'INSPECTOR')) throw new OtError('La bitácora ya fue verificada.', 409);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Contenido que se firma (orden de llaves fijo): encabezado, auxiliares, registros y cierre. */
export interface ContenidoFirmable {
  idOrden: number;
  idCompany: number;
  consecutivo: number;
  producto: string;
  itemCode: string | null;
  lote: string;
  turno: string;
  area: string | null;
  sapOpDocNum: number | null;
  supervisor: string;
  inspector: string | null;
  abiertaEn: string;
  auxiliares: string[];
  registros: Array<{ id: string; actividad: string; usuario: string; registradoEn: string; observacion: string | null }>;
  observacionCierre: string | null;
  cerradaPor?: string | null;
  cerradaEn?: string | null;
  firmaSupervisorSha256?: string | null;
}

/** Huella SHA-256 del contenido firmado (JSON canónico: llaves en orden fijo, auxiliares ordenados). */
export function huellaContenido(c: ContenidoFirmable): string {
  const canon = {
    idOrden: c.idOrden,
    idCompany: c.idCompany,
    consecutivo: c.consecutivo,
    producto: c.producto,
    itemCode: c.itemCode,
    lote: c.lote,
    turno: c.turno,
    area: c.area,
    sapOpDocNum: c.sapOpDocNum,
    supervisor: c.supervisor,
    inspector: c.inspector,
    abiertaEn: c.abiertaEn,
    auxiliares: [...c.auxiliares].sort(),
    registros: c.registros.map((r) => ({ id: r.id, actividad: r.actividad, usuario: r.usuario, registradoEn: r.registradoEn, observacion: r.observacion })),
    observacionCierre: c.observacionCierre,
    cerradaPor: c.cerradaPor ?? null,
    cerradaEn: c.cerradaEn ?? null,
    firmaSupervisorSha256: c.firmaSupervisorSha256 ?? null,
  };
  return sha256(JSON.stringify(canon));
}

/** Imagen de la firma registrada: solo PNG/JPEG en data URL y de tamaño razonable; si no, se omite. */
export function imagenFirmaSegura(dataUrl: string | null | undefined): string | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) return null;
  if (dataUrl.length > 1_500_000) return null;
  return dataUrl;
}

/**
 * Límite de reautenticaciones fallidas (5 en 15 minutos por persona). En memoria
 * del proceso: suficiente para frenar adivinanzas desde la tablet; con varias
 * instancias pm2 el límite es por instancia (P1: llevarlo a la base).
 */
export class LimiteReautenticacion {
  private fallos = new Map<string, number[]>();
  constructor(
    private readonly max = OT_REAUTH_MAX_FALLOS,
    private readonly ventanaMs = OT_REAUTH_VENTANA_MIN * 60_000
  ) {}
  private recientes(email: string, now: number): number[] {
    const k = email.trim().toLowerCase();
    const list = (this.fallos.get(k) ?? []).filter((t) => now - t < this.ventanaMs);
    this.fallos.set(k, list);
    return list;
  }
  bloqueado(email: string, now = Date.now()): boolean {
    return this.recientes(email, now).length >= this.max;
  }
  registrarFallo(email: string, now = Date.now()): void {
    this.recientes(email, now).push(now);
  }
  limpiar(email: string): void {
    this.fallos.delete(email.trim().toLowerCase());
  }
}

export const limiteReautenticacion = new LimiteReautenticacion();

export function assertNoBloqueado(limite: LimiteReautenticacion, email: string, now = Date.now()): void {
  if (limite.bloqueado(email, now)) {
    throw new OtError(`Firma bloqueada: ${OT_REAUTH_MAX_FALLOS} intentos con contraseña incorrecta en ${OT_REAUTH_VENTANA_MIN} minutos. Espere e intente de nuevo.`, 429);
  }
}
