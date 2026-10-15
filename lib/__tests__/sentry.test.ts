import { describe, it, expect } from 'vitest';
import { isPollingPath, makeTracesSampler, sentryBaseOptions } from '../sentry';

describe('Sentry: rutas de sondeo sin trazas (cuota de spans, 2026-10-01)', () => {
  it('reconoce las rutas de sondeo con método, query o URL completa', () => {
    expect(isPollingPath('GET /api/chat/agent/inbox?wait=25')).toBe(true);
    expect(isPollingPath('POST /api/chat/agent/ack')).toBe(true);
    expect(isPollingPath('/api/chat/agent/voice')).toBe(true);
    expect(isPollingPath('GET /api/chat/conversations/12/poll?after=57')).toBe(true);
    expect(isPollingPath('POST /api/chat/conversations/[id]/voice')).toBe(true);
    expect(isPollingPath('GET /api/chat/conversations')).toBe(true);
    expect(isPollingPath('https://groupsharedservices.farmalogica.com:8445/api/chat/pulse?since=9')).toBe(true);
    expect(isPollingPath('GET /api/notifications?status=unread')).toBe(true);
  });

  it('no confunde rutas normales', () => {
    expect(isPollingPath('POST /api/chat/conversations/12/messages')).toBe(false);
    expect(isPollingPath('PATCH /api/notifications/read')).toBe(false);
    expect(isPollingPath('GET /api/help-desk/tickets')).toBe(false);
    expect(isPollingPath('/process/help-desk/create-ticket')).toBe(false);
    expect(isPollingPath(undefined)).toBe(false);
  });

  it('el sampler devuelve 0 en sondeo aunque el padre venga muestreado', () => {
    const sampler = makeTracesSampler(0.1);
    expect(sampler({ name: 'GET /api/chat/agent/inbox', parentSampled: true })).toBe(0);
    expect(sampler({ name: 'GET', attributes: { 'http.target': '/api/chat/pulse?since=1' } })).toBe(0);
    expect(sampler({ name: 'GET', normalizedRequest: { url: 'http://x/api/chat/agent/inbox?wait=25' } })).toBe(0);
  });

  it('el resto usa la tasa o respeta al padre', () => {
    const sampler = makeTracesSampler(0.1);
    expect(sampler({ name: 'GET /api/help-desk/tickets' })).toBe(0.1);
    expect(sampler({ name: 'GET /api/help-desk/tickets', parentSampled: true })).toBe(1);
    expect(sampler({ name: 'GET /api/help-desk/tickets', parentSampled: false })).toBe(0);
  });

  it('quita la integración de Prisma y conserva las demás', () => {
    const result = sentryBaseOptions.integrations([{ name: 'Http' }, { name: 'Prisma' }, { name: 'Console' }]);
    expect(result.map((i) => i.name)).toEqual(['Http', 'Console']);
  });
});
