import bcrypt from 'bcryptjs';
import { OT_PIN_LONGITUD, OT_PIN_MAX_FALLOS } from './constants';
import { OtError } from './rules';

/**
 * PIN personal de la Bitácora de Proceso (B3, 2026-10-15) — reglas PURAS.
 *
 * En la tablet de planta la sesión es la CUENTA COMPARTIDA «Producción». Para que el
 * visto bueno siga siendo ATRIBUIBLE (ALCOA+) sin pedir la contraseña de SynerLink,
 * cada supervisor, inspector y jefe de producción tiene un PIN de 4 dígitos:
 *   - se guarda solo su hash bcrypt (`ot_pin.pin_hash`), nunca el PIN;
 *   - lo configura la persona desde SU sesión («Configurar PIN de bitácora»),
 *     confirmando una vez con su contraseña de SynerLink;
 *   - 5 intentos fallidos lo BLOQUEAN hasta que la persona lo vuelva a configurar o un
 *     supervisor (Gestión) o un administrador lo restablezca (el restablecimiento solo
 *     lo borra: nadie conoce ni fija el PIN de otra persona).
 */
export const OT_PIN_BCRYPT_COSTO = 10;

/** 4 dígitos (OT_PIN_LONGITUD). */
const PIN_RE = /^\d{4}$/;

/** PIN trivial: todos iguales (0000) o consecutivos (1234, 4321). */
export function esPinDebil(pin: string): boolean {
  if (!PIN_RE.test(pin)) return true;
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return true;
  const asc = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  const desc = d.every((x, i) => i === 0 || x === d[i - 1] - 1);
  return asc || desc;
}

export interface PinNuevoInput {
  pin: string;
  password: string;
}

/** Cuerpo de «Configurar PIN»: PIN, confirmación y la contraseña de SynerLink de la persona. */
export function parsePinNuevo(body: Record<string, unknown> | null): PinNuevoInput {
  if (!body) throw new OtError('Se esperaba un JSON con el PIN.', 400);
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  const confirmacion = typeof body.confirmacion === 'string' ? body.confirmacion.trim() : '';
  if (!PIN_RE.test(pin)) throw new OtError(`El PIN debe tener exactamente ${OT_PIN_LONGITUD} dígitos.`, 400);
  if (pin !== confirmacion) throw new OtError('La confirmación no coincide con el PIN.', 400);
  if (esPinDebil(pin)) throw new OtError('Elija un PIN menos obvio (no 0000, 1111, 1234 ni 4321).', 400);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) throw new OtError('Escriba su contraseña de SynerLink para configurar el PIN.', 400);
  if (password.length > 200) throw new OtError('Contraseña no válida.', 400);
  return { pin, password };
}

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, OT_PIN_BCRYPT_COSTO);
}

/** Estado guardado del PIN de una persona (fila de ot_pin, o null si nunca lo configuró). */
export interface PinFila {
  pin_hash: string | null;
  intentos_fallidos: number;
  bloqueado: boolean;
}

export type ResultadoPin = { ok: true } | { ok: false; intentos: number; bloquear: boolean };

/** Antes de comparar: debe existir, tener hash y no estar bloqueado. */
export function assertPinUsable(fila: PinFila | null, nombre: string): asserts fila is PinFila & { pin_hash: string } {
  if (!fila || !fila.pin_hash) {
    throw new OtError(`${nombre} no tiene PIN de bitácora. Debe configurarlo desde su propia sesión («Configurar PIN de bitácora»).`, 409);
  }
  if (fila.bloqueado) {
    throw new OtError(`El PIN de ${nombre} está bloqueado por ${OT_PIN_MAX_FALLOS} intentos fallidos. Un supervisor debe restablecerlo, o la persona configurarlo de nuevo desde su sesión.`, 423);
  }
}

/** Compara el PIN y dice qué guardar: intentos y si se bloquea (al llegar a 5). */
export async function compararPin(fila: PinFila & { pin_hash: string }, pin: string): Promise<ResultadoPin> {
  if (await bcrypt.compare(pin, fila.pin_hash)) return { ok: true };
  const intentos = fila.intentos_fallidos + 1;
  return { ok: false, intentos, bloquear: intentos >= OT_PIN_MAX_FALLOS };
}

/** Mensaje del intento fallido (sin revelar nada del PIN). */
export function mensajePinIncorrecto(r: { intentos: number; bloquear: boolean }): OtError {
  if (r.bloquear) {
    return new OtError(`PIN incorrecto. Se bloqueó tras ${OT_PIN_MAX_FALLOS} intentos: un supervisor debe restablecerlo.`, 423);
  }
  const quedan = OT_PIN_MAX_FALLOS - r.intentos;
  return new OtError(`PIN incorrecto: el visto bueno no se registró. Le ${quedan === 1 ? 'queda 1 intento' : `quedan ${quedan} intentos`}.`, 403);
}
