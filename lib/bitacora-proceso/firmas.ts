import { createHash } from 'node:crypto';
import { OtError, type OtCompanyAccess } from './rules';

/**
 * CONFIRMACIÓN de cierre y verificación de la Bitácora de Proceso — reglas PURAS
 * (probadas con Vitest).
 *
 * Revisión con Farmalógica (2026-10-14, A4): por ahora NO es una firma
 * electrónica con imagen. Es un CHECK («Cerró» del supervisor y «Verificó» del
 * jefe de producción) con nombre, fecha y hora del servidor, respaldado por la
 * contraseña de SynerLink de quien confirma. La validación formal de firmas que
 * exige la norma queda para después. GSS Firma y el SGC no se tocan: la bitácora
 * solo deja de usar la imagen de la firma y el consentimiento de GSS Firma.
 *
 * Tablet con CUENTA COMPARTIDA de planta (Nicolás, 2026-10-14): la sesión no
 * sirve para confirmar. Quien confirma ELIGE SU NOMBRE y escribe SU PROPIA
 * contraseña; el servidor la valida contra la cuenta de esa persona y guarda SU
 * id de usuario (no el de la sesión).
 *
 * La evidencia sigue en `ot_firma` (solo inserción): rol, significado, persona,
 * hora del servidor y huella SHA-256 del contenido. En la base el verificador
 * conserva el rol `INSPECTOR` (no se renombran columnas).
 */
import { OT_CONFIRMACION_TEXTO, OT_FIRMA_SIGNIFICADO, type OtFirmaRol } from './constants';
export { OT_CONFIRMACION_TEXTO, OT_FIRMA_SIGNIFICADO, type OtFirmaRol };
export const OT_FIRMA_AUTH_METHOD = 'contrasena_synerlink';
/** Versión de la confirmación (check) que se guarda en ot_firma.consent_version. */
export const OT_CONFIRMACION_VERSION = 'bitacora-check-2026-10-14';

export const OT_REAUTH_MAX_FALLOS = 5;
export const OT_REAUTH_VENTANA_MIN = 15;

export interface ConfirmacionInput {
  /** user.id de la persona que confirma (elegida de la lista, no la sesión). */
  idFirmante: string;
  password: string;
}

/** Cuerpo de una confirmación: persona elegida, casilla marcada y su contraseña. */
export function parseConfirmacion(body: Record<string, unknown> | null): ConfirmacionInput {
  if (!body) throw new OtError('Se esperaba un JSON con la confirmación.', 400);
  const idFirmante = typeof body.firmante === 'string' ? body.firmante.trim() : '';
  if (!idFirmante) throw new OtError('Elija su nombre para confirmar.', 400);
  if (idFirmante.length > 50) throw new OtError('Persona no válida.', 400);
  if (body.confirmo !== true) throw new OtError('Marque la casilla de confirmación.', 400);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) throw new OtError('Escriba su contraseña de SynerLink para confirmar.', 400);
  if (password.length > 200) throw new OtError('Contraseña no válida.', 400);
  return { idFirmante, password };
}

/** Al abrir: el jefe de producción no puede ser el supervisor que abre (segregación de funciones). */
export function assertInspectorDistinto(inspector: string, supervisor: string): void {
  if (inspector === supervisor) {
    throw new OtError('El jefe de producción debe ser una persona distinta del supervisor que abre la bitácora.', 400);
  }
}

/**
 * Cierre («Cerró»): la persona que confirma debe tener Gestión (supervisor) en la
 * empresa, la bitácora debe estar ABIERTA y quien confirma no es el jefe de producción.
 * `access` es el acceso de QUIEN CONFIRMA (no el de la sesión).
 */
export function assertPuedeCerrar(
  orden: { estado: string; inspector: string | null },
  idUser: string,
  access: OtCompanyAccess | null
): void {
  if (!access?.canManage) throw new OtError('Solo un supervisor (Bitácora de Proceso: Gestión) cierra la bitácora.', 403);
  if (orden.estado !== 'ABIERTA') throw new OtError('La bitácora ya está cerrada.', 409);
  if (orden.inspector && orden.inspector === idUser) {
    throw new OtError('El jefe de producción de esta bitácora no puede cerrarla: la cierra el supervisor y él la verifica.', 403);
  }
}

/** Verificación («Verificó»): solo el jefe de producción designado, después del cierre, una vez. */
export function assertPuedeVerificar(
  orden: { estado: string; inspector: string | null },
  firmas: ReadonlyArray<{ rol: string; id_user: string }>,
  idUser: string
): void {
  if (!orden.inspector || orden.inspector !== idUser) {
    throw new OtError('Solo el jefe de producción designado en esta bitácora puede verificarla.', 403);
  }
  if (orden.estado !== 'CERRADA') throw new OtError('La bitácora se verifica después de que el supervisor la cierre.', 409);
  const sup = firmas.find((f) => f.rol === 'SUPERVISOR');
  if (!sup) throw new OtError('Falta la confirmación de cierre del supervisor.', 409);
  if (sup.id_user === idUser) throw new OtError('Quien cerró la bitácora no puede verificarla.', 403);
  if (firmas.some((f) => f.rol === 'INSPECTOR')) throw new OtError('La bitácora ya fue verificada.', 409);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Contenido que se confirma (orden de llaves fijo): encabezado, auxiliares, operarios, registros y cierre. */
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
  /** Operarios sin usuario programados (ids del maestro). */
  operadores?: number[];
  registros: Array<{ id: string; actividad: string; usuario: string; registradoEn: string; observacion: string | null; operador?: number | null }>;
  observacionCierre: string | null;
  cerradaPor?: string | null;
  cerradaEn?: string | null;
  firmaSupervisorSha256?: string | null;
}

/** Huella SHA-256 del contenido confirmado (JSON canónico: llaves en orden fijo, auxiliares ordenados). */
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
    operadores: [...(c.operadores ?? [])].sort((a, b) => a - b),
    registros: c.registros.map((r) => ({ id: r.id, actividad: r.actividad, usuario: r.usuario, operador: r.operador ?? null, registradoEn: r.registradoEn, observacion: r.observacion })),
    observacionCierre: c.observacionCierre,
    cerradaPor: c.cerradaPor ?? null,
    cerradaEn: c.cerradaEn ?? null,
    firmaSupervisorSha256: c.firmaSupervisorSha256 ?? null,
  };
  return sha256(JSON.stringify(canon));
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
    throw new OtError(`Confirmación bloqueada: ${OT_REAUTH_MAX_FALLOS} intentos con contraseña incorrecta en ${OT_REAUTH_VENTANA_MIN} minutos. Espere e intente de nuevo.`, 429);
  }
}
