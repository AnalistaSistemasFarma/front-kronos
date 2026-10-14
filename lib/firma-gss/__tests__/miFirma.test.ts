import { describe, expect, it, vi } from 'vitest';
import { codificarPng, FirmaImagenError } from '../png';
import { FIRMA_GSS_AUDIT_ACTION, parseFirmaNueva, registrarFirmaGss, type FirmaGssDeps } from '../miFirma';

// «Mi firma» en GSS Firma: imagen saneada, guardada en el maestro de la persona y auditada (sin la imagen).

function firmaPng(): string {
  const w = 4;
  const rgba = new Uint8Array(w * w * 4).fill(255);
  rgba.set([0, 0, 0, 255], 0);
  return `data:image/png;base64,${codificarPng({ width: w, height: w, rgba }).toString('base64')}`;
}

function deps(ok = true): FirmaGssDeps & { guardar: ReturnType<typeof vi.fn>; auditar: ReturnType<typeof vi.fn> } {
  return { guardar: vi.fn().mockResolvedValue(ok ? { ok: true } : { ok: false, error: 'Orión caído' }), auditar: vi.fn().mockResolvedValue({}) };
}

const base = { idUser: 'u1', email: 'yo@farmalogica.com', origen: 'perfil' as const, ip: '10.0.0.9', userAgent: 'vitest' };

describe('Firma GSS · parseFirmaNueva', () => {
  it('opcional; exige imagen y método dibujada/subida', () => {
    expect(parseFirmaNueva(undefined)).toBeNull();
    expect(parseFirmaNueva(null)).toBeNull();
    expect(parseFirmaNueva({ imagen: 'data:x', metodo: 'uploaded' })).toEqual({ imagen: 'data:x', metodo: 'uploaded' });
    expect(parseFirmaNueva({ imagen: 'data:x', metodo: 'drawn' })).toEqual({ imagen: 'data:x', metodo: 'drawn' });
    expect(() => parseFirmaNueva({ imagen: 'data:x', metodo: 'tipografica' })).toThrow(FirmaImagenError);
    expect(() => parseFirmaNueva({ metodo: 'drawn' })).toThrow(FirmaImagenError);
    expect(() => parseFirmaNueva('texto')).toThrow(FirmaImagenError);
    expect(() => parseFirmaNueva([1])).toThrow(FirmaImagenError);
  });
});

describe('Firma GSS · registrarFirmaGss', () => {
  it('guarda la imagen SANEADA en el maestro del correo de la sesión y audita sin la imagen', async () => {
    const d = deps();
    const r = await registrarFirmaGss(d, { ...base, firma: { imagen: firmaPng(), metodo: 'uploaded' } });
    expect(r.guardada).toBe(true);
    expect(r.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(d.guardar).toHaveBeenCalledWith('yo@farmalogica.com', r.dataUrl, 'uploaded');
    expect(d.auditar).toHaveBeenCalledTimes(1);
    const row = d.auditar.mock.calls[0][0];
    expect(row).toMatchObject({ user_id: 'u1', action: FIRMA_GSS_AUDIT_ACTION, performed_by: 'yo@farmalogica.com' });
    const det = JSON.parse(row.details);
    expect(det).toMatchObject({ metodo: 'uploaded', origen: 'perfil', sha256: r.sha256, guardadaEnGssFirma: true, ip: '10.0.0.9' });
    expect(row.details).not.toContain('base64');
  });

  it('si GSS Firma no la guarda (o lanza): devuelve la imagen con guardada=false y lo audita', async () => {
    const d = deps(false);
    const r = await registrarFirmaGss(d, { ...base, origen: 'bitacora-proceso', firma: { imagen: firmaPng(), metodo: 'drawn' } });
    expect(r).toMatchObject({ guardada: false, error: 'Orión caído' });
    expect(JSON.parse(d.auditar.mock.calls[0][0].details)).toMatchObject({ guardadaEnGssFirma: false, origen: 'bitacora-proceso' });
    d.guardar.mockRejectedValueOnce(new Error('timeout'));
    expect(await registrarFirmaGss(d, { ...base, firma: { imagen: firmaPng(), metodo: 'drawn' } })).toMatchObject({ guardada: false, error: 'timeout' });
  });

  it('una imagen no válida no se guarda ni se audita', async () => {
    const d = deps();
    await expect(registrarFirmaGss(d, { ...base, firma: { imagen: 'data:image/svg+xml;base64,PHN2Zz4=', metodo: 'uploaded' } })).rejects.toBeInstanceOf(FirmaImagenError);
    expect(d.guardar).not.toHaveBeenCalled();
    expect(d.auditar).not.toHaveBeenCalled();
  });

  it('si la auditoría falla, el error sube (no se pierde en silencio)', async () => {
    const d = deps();
    d.auditar.mockRejectedValueOnce(new Error('BD'));
    await expect(registrarFirmaGss(d, { ...base, firma: { imagen: firmaPng(), metodo: 'drawn' } })).rejects.toThrow('BD');
  });
});
