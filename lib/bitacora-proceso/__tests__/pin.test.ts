import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { assertPinUsable, compararPin, esPinDebil, hashPin, mensajePinIncorrecto, parsePinNuevo } from '../pin';
import { isOtError, OtError } from '../rules';

// PIN personal de la bitácora (B3, 2026-10-15): 4 dígitos, hash bcrypt, bloqueo a los 5 fallos.

async function errorOfAsync(fn: () => unknown): Promise<OtError> {
  try {
    await fn();
  } catch (e) {
    if (isOtError(e)) return e;
    throw e;
  }
  throw new Error('no lanzó');
}

describe('Bitácora de Proceso · PIN personal', () => {
  it('PIN débil: todos iguales o consecutivos; también lo que no son 4 dígitos', () => {
    for (const p of ['0000', '1111', '1234', '4321', '6789', '123', '12345', 'abcd']) expect(esPinDebil(p)).toBe(true);
    for (const p of ['4821', '1357', '9024', '1123']) expect(esPinDebil(p)).toBe(false);
  });

  it('configurar: 4 dígitos, confirmación igual, no obvio y con la contraseña de SynerLink', async () => {
    expect(parsePinNuevo({ pin: ' 4821 ', confirmacion: '4821', password: 'x' })).toEqual({ pin: '4821', password: 'x' });
    expect((await errorOfAsync(() => parsePinNuevo(null))).status).toBe(400);
    expect((await errorOfAsync(() => parsePinNuevo({ pin: '482', confirmacion: '482', password: 'x' }))).message).toMatch(/4 dígitos/);
    expect((await errorOfAsync(() => parsePinNuevo({ pin: '4821', confirmacion: '4822', password: 'x' }))).message).toMatch(/no coincide/);
    expect((await errorOfAsync(() => parsePinNuevo({ pin: '1234', confirmacion: '1234', password: 'x' }))).message).toMatch(/obvio/);
    expect((await errorOfAsync(() => parsePinNuevo({ pin: '4821', confirmacion: '4821' }))).message).toMatch(/contraseña/);
    expect((await errorOfAsync(() => parsePinNuevo({ pin: '4821', confirmacion: '4821', password: 'x'.repeat(201) }))).status).toBe(400);
  });

  it('se guarda SOLO el hash bcrypt (nunca el PIN) y compara bien', async () => {
    const h = await hashPin('4821');
    expect(h).not.toContain('4821');
    expect(h).toMatch(/^\$2[aby]\$10\$/);
    expect(await bcrypt.compare('4821', h)).toBe(true);
    const fila = { pin_hash: h, intentos_fallidos: 0, bloqueado: false };
    expect(await compararPin(fila, '4821')).toEqual({ ok: true });
    expect(await compararPin(fila, '9999')).toEqual({ ok: false, intentos: 1, bloquear: false });
    expect(await compararPin({ ...fila, intentos_fallidos: 4 }, '9999')).toEqual({ ok: false, intentos: 5, bloquear: true });
  });

  it('sin PIN: 409 (configúrelo); bloqueado: 423; mensajes de intento fallido sin revelar el PIN', async () => {
    expect((await errorOfAsync(() => assertPinUsable(null, 'Ana'))).status).toBe(409);
    expect((await errorOfAsync(() => assertPinUsable({ pin_hash: null, intentos_fallidos: 0, bloqueado: false }, 'Ana'))).message).toMatch(/Configurar PIN/);
    expect((await errorOfAsync(() => assertPinUsable({ pin_hash: 'h', intentos_fallidos: 5, bloqueado: true }, 'Ana'))).status).toBe(423);
    expect(() => assertPinUsable({ pin_hash: 'h', intentos_fallidos: 2, bloqueado: false }, 'Ana')).not.toThrow();
    expect(mensajePinIncorrecto({ intentos: 1, bloquear: false })).toMatchObject({ status: 403, message: expect.stringContaining('quedan 4 intentos') });
    expect(mensajePinIncorrecto({ intentos: 4, bloquear: false }).message).toContain('queda 1 intento');
    expect(mensajePinIncorrecto({ intentos: 5, bloquear: true }).status).toBe(423);
  });
});
