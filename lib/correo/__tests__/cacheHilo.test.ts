import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actualizarMensajeEnCache, HILO_TTL_MS, hiloConCache, invalidarHilo, limpiarCacheHilos, marcarLeidoEnCache } from '../cacheHilo';
import type { MensajeCompleto } from '../types';

const msg = (id: string): MensajeCompleto =>
  ({ id, conversationId: 'C1', internetMessageId: `<${id}>`, asunto: '', de: { nombre: '', correo: '' }, fecha: '', leido: false, conAdjuntos: false, extracto: '', categorias: [], para: [], cc: [], html: '', adjuntos: [] }) as MensajeCompleto;

describe('Correo · caché corta del hilo por persona', () => {
  beforeEach(() => limpiarCacheHilos());

  it('dos peticiones simultáneas del mismo hilo = UNA consulta a Graph', async () => {
    let resolver!: (v: MensajeCompleto[]) => void;
    const cargar = vi.fn(() => new Promise<MensajeCompleto[]>((r) => (resolver = r)));
    const a = hiloConCache('u1', 'C1', cargar);
    const b = hiloConCache('u1', 'C1', cargar);
    resolver([msg('M1')]);
    expect(await a).toEqual(await b);
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  it('reutiliza durante el TTL; vence después; «fresco» la ignora', async () => {
    const cargar = vi.fn(async () => [msg('M1')]);
    await hiloConCache('u1', 'C1', cargar, { ahora: 0 });
    await hiloConCache('u1', 'C1', cargar, { ahora: HILO_TTL_MS - 1 });
    expect(cargar).toHaveBeenCalledTimes(1);
    await hiloConCache('u1', 'C1', cargar, { ahora: HILO_TTL_MS + 1 });
    expect(cargar).toHaveBeenCalledTimes(2);
    await hiloConCache('u1', 'C1', cargar, { ahora: HILO_TTL_MS + 2, fresco: true });
    expect(cargar).toHaveBeenCalledTimes(3);
  });

  it('nunca comparte el hilo entre personas', async () => {
    const cargar = vi.fn(async () => [msg('M1')]);
    await hiloConCache('u1', 'C1', cargar);
    await hiloConCache('u2', 'C1', cargar);
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  it('un error no queda en caché', async () => {
    const cargar = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValueOnce([msg('M1')]);
    await expect(hiloConCache('u1', 'C1', cargar)).rejects.toThrow('429');
    expect(await hiloConCache('u1', 'C1', cargar)).toHaveLength(1);
  });

  it('se invalida por hilo o por persona; una consulta en vuelo invalidada no se guarda', async () => {
    const cargar = vi.fn(async () => [msg('M1')]);
    await hiloConCache('u1', 'C1', cargar);
    await hiloConCache('u1', 'C2', cargar);
    invalidarHilo('u1', 'C1');
    await hiloConCache('u1', 'C1', cargar);
    await hiloConCache('u1', 'C2', cargar);
    expect(cargar).toHaveBeenCalledTimes(3);
    invalidarHilo('u1');
    await hiloConCache('u1', 'C2', cargar);
    expect(cargar).toHaveBeenCalledTimes(4);

    let resolver!: (v: MensajeCompleto[]) => void;
    const lento = vi.fn(() => new Promise<MensajeCompleto[]>((r) => (resolver = r)));
    const p = hiloConCache('u1', 'C9', lento);
    invalidarHilo('u1', 'C9');
    resolver([msg('VIEJO')]);
    await p;
    const nuevo = vi.fn(async () => [msg('NUEVO')]);
    expect((await hiloConCache('u1', 'C9', nuevo))[0].id).toBe('NUEVO');
  });

  it('actualiza un mensaje guardado (imágenes descargadas al desplegarlo)', async () => {
    const cargar = vi.fn(async () => [msg('M1'), msg('M2')]);
    await hiloConCache('u1', 'C1', cargar);
    actualizarMensajeEnCache('u1', 'C1', { ...msg('M2'), imagenesCid: { a: 'data:image/png;base64,AA' } });
    const h = await hiloConCache('u1', 'C1', cargar);
    expect(h[1].imagenesCid).toEqual({ a: 'data:image/png;base64,AA' });
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  it('marcar el hilo actualiza la copia guardada sin volver a consultar', async () => {
    const cargar = vi.fn(async () => [msg('M1'), msg('M2')]);
    await hiloConCache('u1', 'C1', cargar);
    marcarLeidoEnCache('u1', 'C1', ['M2'], true);
    const h = await hiloConCache('u1', 'C1', cargar);
    expect(h.map((m) => m.leido)).toEqual([false, true]);
    expect(cargar).toHaveBeenCalledTimes(1);
  });
});
