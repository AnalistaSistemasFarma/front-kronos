import { beforeEach, describe, expect, it, vi } from 'vitest';

const findDeliveries = vi.hoisted(() => vi.fn());
vi.mock('../../prisma', () => ({ prisma: { chatMessageDelivery: { findMany: findDeliveries } } }));

import { ENTREGAS_PENDIENTES_TANDA, mensajesConEntregaPendiente } from '../entregas-pendientes';

const filas = (ids: number[]) => ids.map((id_message) => ({ id_message }));
const rango = (desde: number, n: number) => Array.from({ length: n }, (_, i) => desde + i);

beforeEach(() => vi.clearAllMocks());

describe('mensajesConEntregaPendiente (incidente CPU 2026-11-03)', () => {
  it('lee SOLO el índice de entregas del agente, sin filtro sobre chat_message', async () => {
    findDeliveries.mockResolvedValueOnce([]);
    const buscar = vi.fn();
    expect(await mensajesConEntregaPendiente(7, 20, buscar)).toEqual([]);
    expect(findDeliveries).toHaveBeenCalledWith({
      where: { id_agent: 7, delivered_at: null },
      orderBy: { id_message: 'asc' },
      take: ENTREGAS_PENDIENTES_TANDA,
      select: { id_message: true },
    });
    // Sin entregas pendientes no se toca chat_message.
    expect(buscar).not.toHaveBeenCalled();
  });

  it('filtra por los ids de sus entregas y respeta el límite', async () => {
    findDeliveries.mockResolvedValueOnce(filas([3, 5, 9]));
    const buscar = vi.fn(async (ids: number[], take: number) => ids.filter((i) => i !== 5).slice(0, take).map((id) => ({ id })));
    expect(await mensajesConEntregaPendiente(7, 1, buscar)).toEqual([{ id: 3 }]);
    expect(buscar).toHaveBeenCalledWith([3, 5, 9], 1);
    expect(findDeliveries).toHaveBeenCalledTimes(1);
  });

  it('si una tanda llena no alcanza, sigue desde el último id (mismo resultado que la consulta original)', async () => {
    const primera = rango(1, ENTREGAS_PENDIENTES_TANDA);
    findDeliveries.mockResolvedValueOnce(filas(primera)).mockResolvedValueOnce(filas([1000, 1001]));
    // Ninguna de la primera tanda pasa el filtro (p. ej. entregas de proyecto).
    const buscar = vi.fn(async (ids: number[], take: number) =>
      ids.filter((i) => i >= 1000).slice(0, take).map((id) => ({ id })),
    );
    expect(await mensajesConEntregaPendiente(7, 20, buscar)).toEqual([{ id: 1000 }, { id: 1001 }]);
    expect(findDeliveries.mock.calls[1][0].where).toEqual({
      id_agent: 7,
      delivered_at: null,
      id_message: { gt: ENTREGAS_PENDIENTES_TANDA },
    });
    expect(buscar).toHaveBeenLastCalledWith([1000, 1001], 20);
  });

  it('una tanda incompleta es la última: no vuelve a consultar', async () => {
    findDeliveries.mockResolvedValueOnce(filas([4]));
    const buscar = vi.fn(async () => []);
    expect(await mensajesConEntregaPendiente(7, 20, buscar)).toEqual([]);
    expect(findDeliveries).toHaveBeenCalledTimes(1);
  });
});
