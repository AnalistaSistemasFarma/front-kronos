import { describe, expect, it, vi } from 'vitest';

// Preparación de quien da un VISTO BUENO (B2/B3, 2026-10-15), sin contraseña:
// sesión propia → «Sí, confirmo»; cuenta compartida de la tablet → PIN de la persona;
// operario → su nombre entre los programados. Dependencias simuladas.

vi.mock('../../../../lib/prisma', () => ({ prisma: {} }));

import { prepararConfirmante, type ConfirmanteDeps } from '../_lib/firmante';
import { parseConfirmacion } from '../../../../lib/bitacora-proceso/firmas';
import { OtError } from '../../../../lib/bitacora-proceso/rules';
import type { OtRequestContext } from '../_lib/context';

const FARMA = 1;
// La sesión es la cuenta COMPARTIDA de planta.
const ctx: OtRequestContext = {
  email: 'produccion@farmalogica.com',
  access: [],
  actor: { idUser: 'u-planta', email: 'produccion@farmalogica.com', ip: '10.0.0.9' },
  isAdmin: false,
};
const sup = { id: 'u-sup', email: 'sup@farmalogica.com', name: ' Supervisora Planta ' };
const accesoSup = [{ idCompany: FARMA, companyName: 'FARMALOGICA S.A.', canOperate: true, canManage: true }];

function deps(persona: typeof sup | null = sup, pinOk = true) {
  const d = {
    persona: vi.fn().mockResolvedValue(persona),
    acceso: vi.fn().mockResolvedValue(accesoSup),
    verificarPin: vi.fn().mockImplementation(async () => {
      if (!pinOk) throw new OtError('PIN incorrecto', 403);
    }),
  };
  return d as ConfirmanteDeps & typeof d;
}

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

describe('Bitácora de Proceso · quien da el visto bueno', () => {
  it('cuenta compartida: valida el PIN de LA PERSONA ELEGIDA y guarda su id, nombre, acceso y la sesión aparte', async () => {
    const d = deps();
    const r = await prepararConfirmante(ctx, FARMA, parseConfirmacion({ rol: 'SUPERVISOR', confirmo: true, persona: 'u-sup', pin: '4821' }), 'tablet', d);
    expect(d.verificarPin).toHaveBeenCalledWith('u-sup', '4821', 'Supervisora Planta', 'produccion@farmalogica.com');
    expect(r).toMatchObject({ rol: 'SUPERVISOR', idUser: 'u-sup', email: 'sup@farmalogica.com', nombre: 'Supervisora Planta', metodo: 'pin_tablet', ip: '10.0.0.9', userAgent: 'tablet' });
    expect(r.sesion).toEqual({ idUser: 'u-planta', email: 'produccion@farmalogica.com' });
    expect(r.access?.canManage).toBe(true);
  });

  it('sesión propia: sin PIN ni contraseña («Sí, confirmo»)', async () => {
    const d = deps({ id: 'u-planta', email: 'produccion@farmalogica.com', name: null as unknown as string });
    const r = await prepararConfirmante(ctx, FARMA, parseConfirmacion({ rol: 'JEFE_PROD', confirmo: true, persona: 'u-planta' }), null, d);
    expect(d.verificarPin).not.toHaveBeenCalled();
    expect(r).toMatchObject({ metodo: 'sesion_propia', idUser: 'u-planta', nombre: 'produccion@farmalogica.com' });
  });

  it('otra sesión sin PIN: 400 antes de consultar; PIN incorrecto: el error de la validación', async () => {
    const d = deps();
    expect(await status(prepararConfirmante(ctx, FARMA, parseConfirmacion({ rol: 'INSPECTOR', confirmo: true, persona: 'u-sup' }), null, d))).toBe(400);
    expect(d.persona).not.toHaveBeenCalled();
    expect(await status(prepararConfirmante(ctx, FARMA, parseConfirmacion({ rol: 'INSPECTOR', confirmo: true, persona: 'u-sup', pin: '9999' }), null, deps(sup, false)))).toBe(403);
  });

  it('persona que no es usuario activo de la empresa: 400 sin validar el PIN', async () => {
    const d = deps(null);
    expect(await status(prepararConfirmante(ctx, FARMA, parseConfirmacion({ rol: 'SUPERVISOR', confirmo: true, persona: 'x', pin: '4821' }), null, d))).toBe(400);
    expect(d.verificarPin).not.toHaveBeenCalled();
  });

  it('operario: sin usuario ni PIN; queda el operario elegido y la sesión', async () => {
    const d = deps();
    const r = await prepararConfirmante(ctx, FARMA, parseConfirmacion({ rol: 'OPERARIO', confirmo: true, operador: 7 }), null, d);
    expect(r).toMatchObject({ rol: 'OPERARIO', idUser: null, idOperador: 7, metodo: 'operario_tablet', access: null });
    expect(d.persona).not.toHaveBeenCalled();
  });

  it('sin acceso al módulo en la empresa, access es null (la capa de datos rechaza el cierre)', async () => {
    const d = deps();
    d.acceso.mockResolvedValue([]);
    const r = await prepararConfirmante(ctx, FARMA, parseConfirmacion({ rol: 'SUPERVISOR', confirmo: true, persona: 'u-sup', pin: '4821' }), null, d);
    expect(r.access).toBeNull();
  });
});
