import { beforeEach, describe, expect, it, vi } from 'vitest';

// Preparación de quien firma (consentimiento, contraseña con límite y firma registrada de GSS Firma), con dependencias simuladas.

const m = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { user: { findFirst: m.findFirst } } }));
vi.mock('../../../../lib/orion/config', () => ({ getOrionConfig: () => ({ enabled: false }) }));
vi.mock('../../../../lib/orion/client', () => ({ loadOrionUserSignature: vi.fn() }));

import { prepararFirmante, type FirmanteDeps } from '../_lib/firmante';
import { LimiteReautenticacion } from '../../../../lib/bitacora-proceso/firmas';
import type { OtRequestContext } from '../_lib/context';

const ctx: OtRequestContext = {
  email: 'sup@farmalogica.com',
  access: [],
  actor: { idUser: 'u1', email: 'sup@farmalogica.com', ip: '10.0.0.9' },
};
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function deps(ok: boolean, imagen: string | null = PNG): FirmanteDeps & { verificar: ReturnType<typeof vi.fn> } {
  return { verificar: vi.fn().mockResolvedValue(ok), firmaRegistrada: vi.fn().mockResolvedValue(imagen), limite: new LimiteReautenticacion(5, 15 * 60_000) };
}

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

beforeEach(() => {
  m.findFirst.mockReset();
  m.findFirst.mockResolvedValue({ name: 'Supervisor Planta' });
});

describe('Bitácora de Proceso · quien firma', () => {
  it('con consentimiento y contraseña correcta: nombre de la base e imagen de la firma registrada', async () => {
    const d = deps(true);
    const f = await prepararFirmante(ctx, { acepto: true, password: 'ok' }, 'vitest', d);
    expect(f).toEqual({ idUser: 'u1', email: 'sup@farmalogica.com', ip: '10.0.0.9', userAgent: 'vitest', nombre: 'Supervisor Planta', imagen: PNG });
    expect(d.verificar).toHaveBeenCalledWith('sup@farmalogica.com', 'ok');
  });

  it('sin consentimiento no verifica la contraseña (400)', async () => {
    const d = deps(true);
    expect(await status(prepararFirmante(ctx, { password: 'ok' }, null, d))).toBe(400);
    expect(d.verificar).not.toHaveBeenCalled();
  });

  it('contraseña incorrecta: 403; a los 5 fallos se bloquea (429) aunque luego acierte', async () => {
    const d = deps(false);
    for (let i = 0; i < 5; i++) expect(await status(prepararFirmante(ctx, { acepto: true, password: 'mala' }, null, d))).toBe(403);
    d.verificar.mockResolvedValue(true);
    expect(await status(prepararFirmante(ctx, { acepto: true, password: 'buena' }, null, d))).toBe(429);
  });

  it('sin firma registrada (o con una imagen no segura) firma igual, sin imagen', async () => {
    expect((await prepararFirmante(ctx, { acepto: true, password: 'ok' }, null, deps(true, null))).imagen).toBeNull();
    expect((await prepararFirmante(ctx, { acepto: true, password: 'ok' }, null, deps(true, 'data:image/svg+xml;base64,PHN2Zz4='))).imagen).toBeNull();
    m.findFirst.mockResolvedValue(null);
    expect((await prepararFirmante(ctx, { acepto: true, password: 'ok' }, null, deps(true))).nombre).toBe('sup@farmalogica.com');
  });
});
