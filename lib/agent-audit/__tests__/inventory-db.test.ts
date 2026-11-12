/**
 * Vencimiento de solicitudes de escaneo del inventario: las 'en_curso' que el
 * recolector no cerró y las 'pendiente' que ningún recolector tomó en 2 horas.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: { agentScanRequest: { updateMany: vi.fn() } },
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('../../prisma', () => ({ prisma }));

import { SOLICITUD_VENCE_MS, vencerSolicitudesColgadas } from '../inventory-db';

describe('vencerSolicitudesColgadas', () => {
  beforeEach(() => {
    prisma.agentScanRequest.updateMany.mockReset();
    prisma.agentScanRequest.updateMany.mockResolvedValue({ count: 0 });
  });

  it('vence las en curso por started_at y las pendientes por requested_at, con el mismo límite de 2 horas', async () => {
    const ahora = new Date('2026-11-09T15:00:00Z');
    const limite = new Date(ahora.getTime() - SOLICITUD_VENCE_MS);
    expect(SOLICITUD_VENCE_MS).toBe(2 * 60 * 60 * 1000);

    await vencerSolicitudesColgadas(ahora);

    const llamadas = prisma.agentScanRequest.updateMany.mock.calls.map((c) => c[0]);
    expect(llamadas).toHaveLength(2);
    expect(llamadas).toContainEqual({
      where: { status: 'en_curso', started_at: { lt: limite } },
      data: { status: 'fallido', finished_at: ahora, error_summary: 'El recolector tomó la solicitud y no terminó a tiempo.' },
    });
    expect(llamadas).toContainEqual({
      where: { status: 'pendiente', requested_at: { lt: limite } },
      data: { status: 'fallido', finished_at: ahora, error_summary: 'Ningún recolector tomó la solicitud.' },
    });
  });

  it('no toca solicitudes completadas ni fallidas', async () => {
    await vencerSolicitudesColgadas(new Date('2026-11-09T15:00:00Z'));
    for (const [arg] of prisma.agentScanRequest.updateMany.mock.calls) {
      expect(['en_curso', 'pendiente']).toContain(arg.where.status);
    }
  });
});
