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

function deps(ok: boolean, imagen: string | null = PNG): FirmanteDeps & { verificar: ReturnType<typeof vi.fn>; registrarFirma: ReturnType<typeof vi.fn>; firmaRegistrada: ReturnType<typeof vi.fn> } {
  return {
    verificar: vi.fn().mockResolvedValue(ok),
    firmaRegistrada: vi.fn().mockResolvedValue(imagen),
    limite: new LimiteReautenticacion(5, 15 * 60_000),
    registrarFirma: vi.fn().mockResolvedValue({ dataUrl: NUEVA, sha256: 'c'.repeat(64), guardada: true }),
  };
}
const NUEVA = 'data:image/png;base64,iVBORw0KGgoAAAA=';

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
    expect(f).toEqual({ idUser: 'u1', email: 'sup@farmalogica.com', ip: '10.0.0.9', userAgent: 'vitest', nombre: 'Supervisor Planta', imagen: PNG, avisoFirma: null });
    expect(d.registrarFirma).not.toHaveBeenCalled();
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

  it('FIRMA NUEVA (dibujada o imagen): DESPUÉS de la contraseña se guarda en SU maestro de GSS Firma y se usa en esta firma', async () => {
    const d = deps(true, null);
    const f = await prepararFirmante(ctx, { acepto: true, password: 'ok', firmaNueva: { imagen: 'data:image/png;base64,xx', metodo: 'uploaded' } }, 'vitest', d);
    expect(d.registrarFirma).toHaveBeenCalledWith({
      idUser: 'u1',
      email: 'sup@farmalogica.com',
      firma: { imagen: 'data:image/png;base64,xx', metodo: 'uploaded' },
      origen: 'bitacora-proceso',
      ip: '10.0.0.9',
      userAgent: 'vitest',
    });
    expect(f.imagen).toBe(NUEVA);
    expect(f.avisoFirma).toBeNull();
    expect(d.firmaRegistrada).not.toHaveBeenCalled();
  });

  it('FIRMA NUEVA: con contraseña incorrecta NO se guarda; con método inválido es 400 sin verificar', async () => {
    const d = deps(false);
    expect(await status(prepararFirmante(ctx, { acepto: true, password: 'mala', firmaNueva: { imagen: 'data:x', metodo: 'drawn' } }, null, d))).toBe(403);
    expect(d.registrarFirma).not.toHaveBeenCalled();
    const d2 = deps(true);
    expect(await status(prepararFirmante(ctx, { acepto: true, password: 'ok', firmaNueva: { imagen: 'data:x', metodo: 'tipografica' } }, null, d2))).toBe(400);
    expect(d2.verificar).not.toHaveBeenCalled();
  });

  it('FIRMA NUEVA: imagen no válida es 400; si GSS Firma no la guarda, firma con ella y avisa', async () => {
    const { FirmaImagenError } = await import('../../../../lib/firma-gss/png');
    const d = deps(true);
    d.registrarFirma.mockRejectedValueOnce(new FirmaImagenError('La firma debe llegar como imagen PNG.'));
    expect(await status(prepararFirmante(ctx, { acepto: true, password: 'ok', firmaNueva: { imagen: 'data:x', metodo: 'drawn' } }, null, d))).toBe(400);
    d.registrarFirma.mockResolvedValueOnce({ dataUrl: NUEVA, sha256: 'c'.repeat(64), guardada: false, error: 'caído' });
    const f = await prepararFirmante(ctx, { acepto: true, password: 'ok', firmaNueva: { imagen: 'data:x', metodo: 'drawn' } }, null, d);
    expect(f.imagen).toBe(NUEVA);
    expect(f.avisoFirma).toMatch(/GSS Firma no la guardó/);
    d.registrarFirma.mockRejectedValueOnce(new Error('BD'));
    await expect(prepararFirmante(ctx, { acepto: true, password: 'ok', firmaNueva: { imagen: 'data:x', metodo: 'drawn' } }, null, d)).rejects.toThrow('BD');
  });
});
