import { describe, expect, it, vi } from 'vitest';

// Preparación de quien CONFIRMA «Cerró» / «Verificó» (A4, 2026-10-14): la persona
// elegida (no la sesión de la tablet), su contraseña con límite de intentos y su
// acceso al módulo. Sin imagen de firma ni GSS Firma. Dependencias simuladas.

vi.mock('../../../../lib/prisma', () => ({ prisma: {} }));

import { prepararFirmante, type FirmanteDeps } from '../_lib/firmante';
import { LimiteReautenticacion } from '../../../../lib/bitacora-proceso/firmas';
import type { OtRequestContext } from '../_lib/context';

const FARMA = 1;
// La sesión es la cuenta COMPARTIDA de planta.
const ctx: OtRequestContext = {
  email: 'produccion@farmalogica.com',
  access: [],
  actor: { idUser: 'u-planta', email: 'produccion@farmalogica.com', ip: '10.0.0.9' },
};
const sup = { id: 'u-sup', email: 'sup@farmalogica.com', name: ' Supervisora Planta ' };
const accesoSup = [{ idCompany: FARMA, companyName: 'FARMALOGICA S.A.', canOperate: true, canManage: true }];

function deps(ok: boolean, persona: typeof sup | null = sup) {
  const d = {
    verificar: vi.fn().mockResolvedValue(ok),
    limite: new LimiteReautenticacion(5, 15 * 60_000),
    persona: vi.fn().mockResolvedValue(persona),
    acceso: vi.fn().mockResolvedValue(accesoSup),
  };
  return d as FirmanteDeps & typeof d;
}
const body = { firmante: 'u-sup', confirmo: true, password: 'propia' };

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

describe('Bitácora de Proceso · quien confirma', () => {
  it('valida la contraseña de LA PERSONA ELEGIDA (no la de la sesión) y devuelve su id, nombre y acceso', async () => {
    const d = deps(true);
    const f = await prepararFirmante(ctx, FARMA, body, 'vitest', d);
    expect(d.persona).toHaveBeenCalledWith('u-sup', FARMA);
    expect(d.verificar).toHaveBeenCalledWith('sup@farmalogica.com', 'propia');
    expect(d.acceso).toHaveBeenCalledWith('sup@farmalogica.com');
    expect(f).toEqual({
      idUser: 'u-sup',
      email: 'sup@farmalogica.com',
      ip: '10.0.0.9',
      userAgent: 'vitest',
      nombre: 'Supervisora Planta',
      access: accesoSup[0],
    });
    expect(f.idUser).not.toBe(ctx.actor.idUser);
  });

  it('sin acceso al módulo en la empresa, access es null (la capa de datos rechaza el cierre)', async () => {
    const d = deps(true);
    d.acceso.mockResolvedValue([{ ...accesoSup[0], idCompany: 3 }]);
    expect((await prepararFirmante(ctx, FARMA, body, null, d)).access).toBeNull();
  });

  it('persona que no es usuario activo de la empresa: 400 sin verificar contraseña', async () => {
    const d = deps(true, null);
    expect(await status(prepararFirmante(ctx, FARMA, body, null, d))).toBe(400);
    expect(d.verificar).not.toHaveBeenCalled();
  });

  it('exige casilla y contraseña (400) antes de consultar nada', async () => {
    const d = deps(true);
    expect(await status(prepararFirmante(ctx, FARMA, { ...body, confirmo: false }, null, d))).toBe(400);
    expect(await status(prepararFirmante(ctx, FARMA, { ...body, password: '' }, null, d))).toBe(400);
    expect(await status(prepararFirmante(ctx, FARMA, { ...body, firmante: '' }, null, d))).toBe(400);
    expect(d.persona).not.toHaveBeenCalled();
  });

  it('contraseña incorrecta: 403; a los 5 fallos de ESA persona se bloquea (429) aunque luego acierte', async () => {
    const d = deps(false);
    for (let i = 0; i < 5; i++) expect(await status(prepararFirmante(ctx, FARMA, body, null, d))).toBe(403);
    d.verificar.mockResolvedValue(true);
    expect(await status(prepararFirmante(ctx, FARMA, body, null, d))).toBe(429);
    // El bloqueo es por persona: la sesión compartida no queda bloqueada para otro supervisor.
    d.persona.mockResolvedValue({ id: 'u-sup2', email: 'sup2@farmalogica.com', name: 'Otro' });
    expect(await status(prepararFirmante(ctx, FARMA, { ...body, firmante: 'u-sup2' }, null, d))).toBe(0);
  });

  it('sin nombre en la base usa el correo', async () => {
    const d = deps(true, { ...sup, name: '  ' });
    expect((await prepararFirmante(ctx, FARMA, body, null, d)).nombre).toBe('sup@farmalogica.com');
  });
});
