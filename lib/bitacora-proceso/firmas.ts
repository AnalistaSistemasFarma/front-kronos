import { createHash } from 'node:crypto';
import { OtError, type OtCompanyAccess } from './rules';

/**
 * VISTOS BUENOS de la Bitácora de Proceso — reglas PURAS (probadas con Vitest).
 *
 * Revisión con Farmalógica del 2026-10-15 (B1 a B3; nota
 * reuniones/2026-10-15-revision-cambios-bitacora-proceso-farmalogica.md):
 *   - CUATRO actores y cuatro vistos buenos («chulitos»): operario, supervisor,
 *     inspector y jefe de producción. El del supervisor es el CIERRE («Cerró»).
 *   - ORDEN (decisión técnica para confirmar con Nicolás; el código anterior ya exigía
 *     el cierre antes de la verificación): operario → supervisor → inspector → jefe.
 *     Solo se exigen los actores que la bitácora tiene: el operario si hay operarios
 *     programados, el inspector si se designó (las bitácoras del #617 no lo tienen).
 *   - SIN CONTRASEÑA (B3): desde la SESIÓN PROPIA de la persona basta «Sí, confirmo»;
 *     desde otra sesión (la cuenta compartida «Producción» de la tablet) la persona elige
 *     su nombre y escribe su PIN personal de 4 dígitos (ver pin.ts). El operario, que no
 *     tiene usuario, toca su nombre entre los programados en la bitácora.
 *   - La evidencia sigue en `ot_firma` (solo inserción): rol, persona, hora del servidor,
 *     cómo se confirmó (auth_method), usuario de la sesión, IP y huella SHA-256.
 *   - GSS Firma y el SGC NO se tocan.
 *
 * Las filas del modelo anterior (#606/#617) con rol INSPECTOR y significado «Verificó»
 * eran del JEFE DE PRODUCCIÓN: se LEEN como JEFE_PROD sin modificar la evidencia.
 */
import {
  OT_CONFIRMACION_TEXTO,
  OT_FIRMA_SIGNIFICADO,
  OT_LIMITS,
  OT_METODO_CONFIRMACION,
  OT_PIN_LONGITUD,
  OT_ROL_LABEL,
  OT_SIGNIFICADO_VERIFICO_LEGADO,
  OT_VISTOS_BUENOS,
  isOtFirmaRol,
  type OtFirmaRol,
} from './constants';
export { OT_CONFIRMACION_TEXTO, OT_FIRMA_SIGNIFICADO, OT_VISTOS_BUENOS, type OtFirmaRol };

/** Versión de la confirmación que se guarda en ot_firma.consent_version. */
export const OT_CONFIRMACION_VERSION = 'bitacora-visto-bueno-2026-10-15';

export type OtMetodoConfirmacion = (typeof OT_METODO_CONFIRMACION)[keyof typeof OT_METODO_CONFIRMACION];

/** Rol VISIBLE de una fila de ot_firma (las del modelo anterior «Verificó» son del jefe). */
export function rolVisible(f: { rol: string; significado: string }): OtFirmaRol | null {
  if (f.rol === 'INSPECTOR' && f.significado === OT_SIGNIFICADO_VERIFICO_LEGADO) return 'JEFE_PROD';
  return isOtFirmaRol(f.rol) ? f.rol : null;
}

export interface FirmaFila {
  rol: string;
  significado: string;
  id_user: string;
  id_operador?: number | null;
  content_sha256?: string;
}

/** Visto bueno dado por cada rol visible (o null si falta). */
export function vistosDados<T extends FirmaFila>(firmas: readonly T[]): Record<OtFirmaRol, T | null> {
  const out = { OPERARIO: null, SUPERVISOR: null, INSPECTOR: null, JEFE_PROD: null } as Record<OtFirmaRol, T | null>;
  for (const f of firmas) {
    const r = rolVisible(f);
    if (r && !out[r]) out[r] = f;
  }
  return out;
}

/** Lo que una bitácora necesita para saber qué vistos buenos le corresponden. */
export interface OrdenActores {
  estado: string;
  inspector: string | null;
  jefe: string | null;
  /** Operarios sin usuario programados (ids del maestro). */
  operadores: readonly number[];
}

/** Vistos buenos que EXIGE esta bitácora, en orden. */
export function vistosRequeridos(o: Pick<OrdenActores, 'inspector' | 'jefe' | 'operadores'>): OtFirmaRol[] {
  return OT_VISTOS_BUENOS.filter((r) => {
    if (r === 'OPERARIO') return o.operadores.length > 0;
    if (r === 'INSPECTOR') return Boolean(o.inspector);
    if (r === 'JEFE_PROD') return Boolean(o.jefe);
    return true;
  });
}

/** Siguiente visto bueno pendiente (o null si ya están todos). */
export function siguienteVistoBueno(o: OrdenActores, firmas: readonly FirmaFila[]): OtFirmaRol | null {
  const dados = vistosDados(firmas);
  return vistosRequeridos(o).find((r) => !dados[r]) ?? null;
}

/** Bitácora completa: cerrada y con todos los vistos buenos que le corresponden. */
export function vistosCompletos(o: OrdenActores, firmas: readonly FirmaFila[]): boolean {
  return o.estado === 'CERRADA' && siguienteVistoBueno(o, firmas) === null;
}

/** Quien da el visto bueno: la persona (usuario) o el operario (sin usuario). */
export interface Confirmante {
  rol: OtFirmaRol;
  /** user.id de la persona que confirma (supervisor, inspector o jefe). */
  idUser: string | null;
  /** Operario del maestro (rol OPERARIO). */
  idOperador: number | null;
  /** Acceso al módulo de ESA persona en la empresa (no el de la sesión). */
  access: OtCompanyAccess | null;
}

/**
 * ¿Puede dar este visto bueno? Aplica el ORDEN, la designación y la segregación de
 * funciones. 409 = fuera de orden o ya dado; 403 = no es la persona que corresponde.
 */
export function assertPuedeConfirmar(o: OrdenActores, firmas: readonly FirmaFila[], c: Confirmante): void {
  const dados = vistosDados(firmas);
  const label = OT_ROL_LABEL[c.rol];
  if (dados[c.rol]) throw new OtError(`El visto bueno del ${label.toLowerCase()} ya se dio.`, 409);
  const faltaAntes = (r: OtFirmaRol) => vistosRequeridos(o).includes(r) && !dados[r];

  switch (c.rol) {
    case 'OPERARIO': {
      if (o.estado !== 'ABIERTA') throw new OtError('El visto bueno del operario se da antes del cierre.', 409);
      if (o.operadores.length === 0) throw new OtError('Esta bitácora no tiene operarios programados.', 409);
      if (c.idOperador === null || !o.operadores.includes(c.idOperador)) {
        throw new OtError('El operario elegido no está programado en esta bitácora.', 403);
      }
      return;
    }
    case 'SUPERVISOR': {
      if (o.estado !== 'ABIERTA') throw new OtError('La bitácora ya está cerrada.', 409);
      if (!c.access?.canManage) throw new OtError('Solo un supervisor (Bitácora de Proceso: Gestión) cierra la bitácora.', 403);
      if (c.idUser && (c.idUser === o.inspector || c.idUser === o.jefe)) {
        throw new OtError('El inspector o el jefe de producción de esta bitácora no pueden cerrarla: la cierra el supervisor.', 403);
      }
      if (faltaAntes('OPERARIO')) throw new OtError('Falta el visto bueno del operario: un operario del turno debe darlo antes del cierre.', 409);
      return;
    }
    case 'INSPECTOR':
    case 'JEFE_PROD': {
      const designado = c.rol === 'INSPECTOR' ? o.inspector : o.jefe;
      if (!designado) throw new OtError(`Esta bitácora no tiene ${label.toLowerCase()} designado.`, 409);
      if (c.idUser !== designado) throw new OtError(`Solo el ${label.toLowerCase()} designado en esta bitácora puede dar este visto bueno.`, 403);
      if (o.estado !== 'CERRADA' || !dados.SUPERVISOR) throw new OtError(`El visto bueno del ${label.toLowerCase()} se da después del cierre del supervisor.`, 409);
      if (dados.SUPERVISOR.id_user === c.idUser) throw new OtError('Quien cerró la bitácora no puede dar este visto bueno.', 403);
      if (c.rol === 'JEFE_PROD' && faltaAntes('INSPECTOR')) throw new OtError('Falta el visto bueno del inspector.', 409);
      return;
    }
  }
}

/**
 * Al abrir (B1): supervisor que abre, inspector y jefe de producción son tres personas
 * distintas (segregación de funciones).
 */
export function assertActoresDistintos(a: { supervisor: string; inspector: string; jefe: string }): void {
  if (a.inspector === a.supervisor) throw new OtError('El inspector debe ser una persona distinta del supervisor que abre la bitácora.', 400);
  if (a.jefe === a.supervisor) throw new OtError('El jefe de producción debe ser una persona distinta del supervisor que abre la bitácora.', 400);
  if (a.inspector === a.jefe) throw new OtError('El inspector y el jefe de producción deben ser personas distintas.', 400);
}

export interface ConfirmacionInput {
  rol: OtFirmaRol;
  /** user.id de la persona elegida (supervisor, inspector o jefe). */
  persona: string | null;
  /** Operario elegido (rol OPERARIO). */
  idOperador: number | null;
  /** PIN de 4 dígitos (solo cuando la sesión no es de la persona). */
  pin: string | null;
  observacion: string | null;
}

/** Cuerpo de un visto bueno: rol, quién, «Sí, confirmo» y, si hace falta, el PIN. */
export function parseConfirmacion(body: Record<string, unknown> | null, rolFijo?: OtFirmaRol): ConfirmacionInput {
  if (!body) throw new OtError('Se esperaba un JSON con la confirmación.', 400);
  const rol = rolFijo ?? body.rol;
  if (!isOtFirmaRol(rol)) throw new OtError('Visto bueno no válido.', 400);
  if (body.confirmo !== true) throw new OtError('Toque «Sí, confirmo» para dar el visto bueno.', 400);
  let persona: string | null = null;
  let idOperador: number | null = null;
  if (rol === 'OPERARIO') {
    const n = Number(body.operador ?? body.id_operador);
    if (!Number.isInteger(n) || n < 1) throw new OtError('Elija su nombre (operario).', 400);
    idOperador = n;
  } else {
    persona = typeof body.persona === 'string' ? body.persona.trim() : typeof body.firmante === 'string' ? body.firmante.trim() : '';
    if (!persona) throw new OtError('Elija su nombre para confirmar.', 400);
    if (persona.length > 50) throw new OtError('Persona no válida.', 400);
  }
  let pin: string | null = null;
  if (body.pin !== undefined && body.pin !== null && body.pin !== '') {
    pin = typeof body.pin === 'string' ? body.pin.trim() : String(body.pin);
    if (!/^\d{4}$/.test(pin) || pin.length !== OT_PIN_LONGITUD) throw new OtError(`El PIN es de ${OT_PIN_LONGITUD} dígitos.`, 400);
  }
  const obs = typeof body.observacion === 'string' ? body.observacion.trim() : '';
  if (obs.length > OT_LIMITS.observacionCierre) throw new OtError(`La observación de cierre: máximo ${OT_LIMITS.observacionCierre} caracteres.`, 400);
  return { rol, persona, idOperador, pin, observacion: rol === 'SUPERVISOR' && obs ? obs : null };
}

/**
 * Cómo se confirma (B3): la persona en SU sesión → sin PIN; desde otra sesión (cuenta
 * compartida de la tablet) → PIN obligatorio; el operario (sin usuario) → en la tablet.
 */
export function metodoConfirmacion(input: Pick<ConfirmacionInput, 'rol' | 'persona' | 'pin'>, idUserSesion: string): OtMetodoConfirmacion {
  if (input.rol === 'OPERARIO') return OT_METODO_CONFIRMACION.operarioTablet;
  if (input.persona === idUserSesion) return OT_METODO_CONFIRMACION.sesionPropia;
  if (!input.pin) throw new OtError('Desde una sesión que no es la suya, escriba su PIN de bitácora de 4 dígitos.', 400);
  return OT_METODO_CONFIRMACION.pinTablet;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Contenido que se confirma (orden de llaves fijo): encabezado, actores, registros, cierre y vistos previos. */
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
  jefeProduccion?: string | null;
  abiertaEn: string;
  auxiliares: string[];
  /** Operarios sin usuario programados (ids del maestro). */
  operadores?: number[];
  registros: Array<{ id: string; actividad: string; usuario: string; registradoEn: string; observacion: string | null; operador?: number | null }>;
  observacionCierre: string | null;
  cerradaPor?: string | null;
  cerradaEn?: string | null;
  /** Huella del cierre del supervisor (modelo anterior) — se conserva por compatibilidad. */
  firmaSupervisorSha256?: string | null;
  /** Huellas de los vistos buenos anteriores, en orden (encadenan la evidencia). */
  vistosPrevios?: Array<{ rol: string; sha256: string }>;
}

/** Huella SHA-256 del contenido confirmado (JSON canónico: llaves en orden fijo, listas ordenadas). */
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
    ...(c.jefeProduccion !== undefined ? { jefeProduccion: c.jefeProduccion } : {}),
    abiertaEn: c.abiertaEn,
    auxiliares: [...c.auxiliares].sort(),
    operadores: [...(c.operadores ?? [])].sort((a, b) => a - b),
    registros: c.registros.map((r) => ({ id: r.id, actividad: r.actividad, usuario: r.usuario, operador: r.operador ?? null, registradoEn: r.registradoEn, observacion: r.observacion })),
    observacionCierre: c.observacionCierre,
    cerradaPor: c.cerradaPor ?? null,
    cerradaEn: c.cerradaEn ?? null,
    firmaSupervisorSha256: c.firmaSupervisorSha256 ?? null,
    ...(c.vistosPrevios ? { vistosPrevios: c.vistosPrevios.map((v) => ({ rol: v.rol, sha256: v.sha256 })) } : {}),
  };
  return sha256(JSON.stringify(canon));
}

/**
 * Límite de intentos fallidos en memoria del proceso (5 en 15 minutos por persona).
 * Se usa para la contraseña que pide «Configurar PIN» (el PIN en sí lleva su contador
 * en la base: ot_pin.intentos_fallidos, ver pin.ts).
 */
export const OT_REAUTH_MAX_FALLOS = 5;
export const OT_REAUTH_VENTANA_MIN = 15;

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
    throw new OtError(`Bloqueado: ${OT_REAUTH_MAX_FALLOS} intentos con contraseña incorrecta en ${OT_REAUTH_VENTANA_MIN} minutos. Espere e intente de nuevo.`, 429);
  }
}
