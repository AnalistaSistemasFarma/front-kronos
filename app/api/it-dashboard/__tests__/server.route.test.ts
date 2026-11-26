import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dashboard TI server panel (2026-11-26): session, access and DB are mocked.

const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  canViewItDashboard: vi.fn(),
  loadAssetTypeName: vi.fn(),
  loadServerNetwork: vi.fn(),
  loadServerPerformance: vi.fn(),
  saveServerNetwork: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/it-dashboard/access', () => ({ canViewItDashboard: m.canViewItDashboard }));
vi.mock('../../../../lib/it-dashboard/serverDb', () => ({
  loadAssetTypeName: m.loadAssetTypeName,
  loadServerNetwork: m.loadServerNetwork,
  loadServerPerformance: m.loadServerPerformance,
  saveServerNetwork: m.saveServerNetwork,
}));

import { GET, PUT } from '../assets/[id]/server/route';

const EMAIL = 'cristian.baldion@gsslatam.com';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body?: unknown) =>
  new Request('http://x/api/it-dashboard/assets/68/server', {
    method: body ? 'PUT' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
  });

const network = { hostname: 'PCE0023', ipAddress: '10.0.0.5' };
const performance = { state: 'none' };

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.canViewItDashboard.mockResolvedValue(true);
  m.loadAssetTypeName.mockResolvedValue({ type: 'SERVIDOR' });
  m.loadServerNetwork.mockResolvedValue(network);
  m.loadServerPerformance.mockResolvedValue(performance);
  m.saveServerNetwork.mockResolvedValue(network);
});

describe('/api/it-dashboard/assets/[id]/server', () => {
  it('401 / 403 / 400 / 404 guards; nothing is saved', async () => {
    m.getServerSession.mockResolvedValueOnce(null);
    expect((await GET(req(), ctx('68'))).status).toBe(401);

    m.canViewItDashboard.mockResolvedValueOnce(false);
    expect((await PUT(req({ hostname: 'x' }), ctx('68'))).status).toBe(403);

    expect((await GET(req(), ctx('abc'))).status).toBe(400);

    m.loadAssetTypeName.mockResolvedValueOnce(null);
    expect((await GET(req(), ctx('68'))).status).toBe(404);

    m.loadAssetTypeName.mockResolvedValueOnce({ type: 'COMPUTADORES' });
    expect((await PUT(req({ hostname: 'x' }), ctx('68'))).status).toBe(400);

    expect(m.saveServerNetwork).not.toHaveBeenCalled();
  });

  it('GET returns network and performance of the server', async () => {
    const res = await GET(req(), ctx('68'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ network, performance });
    expect(m.loadServerPerformance).toHaveBeenCalledWith('PCE0023');
  });

  it('PUT validates and saves with the user email', async () => {
    const bad = await PUT(req({ ipAddress: '999.1.1.1' }), ctx('68'));
    expect(bad.status).toBe(400);
    expect((await bad.json()).fields.ipAddress).toBeTruthy();

    const ok = await PUT(req({ hostname: 'PCE0023', ipAddress: '10.0.0.5' }), ctx('68'));
    expect(ok.status).toBe(200);
    expect(m.saveServerNetwork).toHaveBeenCalledWith(
      68,
      expect.objectContaining({ hostname: 'PCE0023', ipAddress: '10.0.0.5' }),
      EMAIL
    );
  });
});
